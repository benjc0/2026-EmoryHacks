"""Typesense collections shared with the rest of the team, plus indexing of a finished visit.

Run once to create collections + synonyms:
    python search_index.py setup          (add --reset to drop and recreate)

Talks to Typesense over plain HTTP so it works on v29 and v30+ (synonym sets).
"""
from __future__ import annotations

import json
import logging
import sys
import time

import httpx

import config

log = logging.getLogger("typesense")


def _embed(fields: list[str]) -> list[dict]:
    if config.TYPESENSE_EMBED_MODEL.lower() == "off":
        return []
    return [{"name": "embedding", "type": "float[]",
             "embed": {"from": fields, "model_config": {"model_name": config.TYPESENSE_EMBED_MODEL}}}]


def _f(name, type_="string", facet=False, optional=False, locale=None):
    d = {"name": name, "type": type_, "facet": facet, "optional": optional}
    if locale:
        d["locale"] = locale
    return d


def schemas(pat_locale: str = "ko") -> list[dict]:
    base = [_f("patient_id", facet=True), _f("visit_id", facet=True),
            _f("provider", facet=True, optional=True), _f("date", "int64")]
    return [
        {"name": "visit_chunks", "default_sorting_field": "date", "fields": base + [
            _f("start_sec", "int32"), _f("speakers", "string[]", facet=True),
            _f("text"),                                    # original speech, both speakers
            _f("text_doctor_lang", optional=True),
            _f("text_patient_lang", optional=True, locale=pat_locale),
        ] + _embed(["text_doctor_lang", "text_patient_lang"])},

        {"name": "visits", "default_sorting_field": "date", "fields": base + [
            _f("specialty", facet=True, optional=True),
            _f("summary_doctor_lang"), _f("summary_patient_lang", locale=pat_locale),
            _f("key_points_patient_lang", "string[]", locale=pat_locale),
        ] + _embed(["summary_doctor_lang", "summary_patient_lang"])},

        {"name": "medications", "default_sorting_field": "date", "fields": base + [
            _f("name"), _f("generic_name", optional=True), _f("dose", optional=True),
            _f("frequency", optional=True), _f("purpose", optional=True),
            _f("instructions", optional=True), _f("change", facet=True),
            _f("explanation_patient_lang", locale=pat_locale), _f("source", facet=True),
        ]},

        {"name": "exercises", "default_sorting_field": "date", "fields": base + [
            _f("name"), _f("body_part", facet=True, optional=True),
            _f("sets", optional=True), _f("reps", optional=True), _f("frequency", optional=True),
            _f("form_cues", "string[]"), _f("explanation_patient_lang", locale=pat_locale),
        ] + _embed(["name", "body_part", "form_cues"])},

        {"name": "care_items", "default_sorting_field": "date", "fields": base + [
            _f("type", facet=True), _f("text"), _f("text_patient_lang", locale=pat_locale),
            _f("due", optional=True), _f("status", facet=True), _f("source", facet=True),
        ]},
    ]


# Starter synonyms: everyday words <-> medical terms, Korean <-> English.
SYNONYMS = [
    {"id": "blood-thinner", "synonyms": ["blood thinner", "anticoagulant", "warfarin", "apixaban", "eliquis", "혈액 희석제", "항응고제"]},
    {"id": "painkiller", "synonyms": ["painkiller", "pain reliever", "analgesic", "ibuprofen", "acetaminophen", "tylenol", "진통제"]},
    {"id": "blood-pressure", "synonyms": ["blood pressure", "hypertension", "bp", "혈압", "고혈압"]},
    {"id": "diabetes", "synonyms": ["diabetes", "blood sugar", "glucose", "metformin", "당뇨", "혈당"]},
    {"id": "knee", "synonyms": ["knee", "무릎"]},
    {"id": "shoulder", "synonyms": ["shoulder", "어깨"]},
    {"id": "back", "synonyms": ["back", "lower back", "허리", "등"]},
    {"id": "follow-up", "synonyms": ["follow up", "follow-up", "next appointment", "다음 예약", "재방문"]},
    {"id": "side-effect", "synonyms": ["side effect", "adverse effect", "부작용"]},
    {"id": "antibiotic", "synonyms": ["antibiotic", "amoxicillin", "항생제"]},
]
SYNONYM_SET = "clinic-synonyms"


def _client() -> httpx.Client:
    return httpx.Client(base_url=config.TYPESENSE_URL, timeout=60,
                        headers={"X-TYPESENSE-API-KEY": config.TYPESENSE_API_KEY})


def _major_version(c: httpx.Client) -> int:
    try:
        v = c.get("/debug").json().get("version", "0")
        return int(str(v).lstrip("v").split(".")[0])
    except Exception:
        return 0


def setup(reset: bool = False, pat_locale: str = "ko"):
    if not config.TYPESENSE_URL:
        sys.exit("Set TYPESENSE_HOST and TYPESENSE_API_KEY first (see .env.example).")
    with _client() as c:
        v30 = _major_version(c) >= 30
        if v30:
            r = c.put(f"/synonym_sets/{SYNONYM_SET}", json={"items": SYNONYMS})
            print("synonym set:", r.status_code)
        for s in schemas(pat_locale):
            if reset:
                c.delete(f"/collections/{s['name']}")
            if v30:
                s = {**s, "synonym_sets": [SYNONYM_SET]}
            r = c.post("/collections", json=s)
            print(f"collection {s['name']}: {r.status_code} {'' if r.is_success else r.text[:200]}")
            if not v30:
                for syn in SYNONYMS:
                    c.put(f"/collections/{s['name']}/synonyms/{syn['id']}", json={"synonyms": syn["synonyms"]})


# ---------------------------------------------------------------- indexing

def _chunks(utterances: list[dict], seconds: int = 30) -> list[list[dict]]:
    out, cur, start = [], [], None
    for u in utterances:
        if start is None:
            start = u["t"]
        if u["t"] - start > seconds and cur:
            out.append(cur)
            cur, start = [], u["t"]
        cur.append(u)
    if cur:
        out.append(cur)
    return out


def build_documents(visit: dict) -> dict[str, list[dict]]:
    """Turn a finished visit into Typesense documents, keyed by collection."""
    vid, pid = visit["id"], visit["patient_id"]
    common = {"patient_id": pid, "visit_id": vid, "provider": visit.get("provider") or "",
              "date": int(visit.get("started_at", time.time()))}
    notes, summary = visit.get("notes") or {}, visit.get("summary") or {}
    docs: dict[str, list[dict]] = {k: [] for k in ["visit_chunks", "visits", "medications", "exercises", "care_items"]}

    for i, chunk in enumerate(_chunks(visit["utterances"])):
        doc_lang_text, pat_lang_text = [], []
        for u in chunk:
            # original is in the speaker's language; translated is in the other one
            if u["speaker"] == "doctor":
                doc_lang_text.append(f"Doctor: {u['original']}"); pat_lang_text.append(f"Doctor: {u['translated']}")
            else:
                pat_lang_text.append(f"Patient: {u['original']}"); doc_lang_text.append(f"Patient: {u['translated']}")
        docs["visit_chunks"].append({**common, "id": f"{vid}-c{i}", "start_sec": int(chunk[0]["t"]),
                                     "speakers": sorted({u["speaker"] for u in chunk}),
                                     "text": " ".join(u["original"] for u in chunk),
                                     "text_doctor_lang": "\n".join(doc_lang_text),
                                     "text_patient_lang": "\n".join(pat_lang_text)})

    if summary:
        docs["visits"].append({**common, "id": vid, "specialty": visit.get("specialty") or "",
                               "summary_doctor_lang": summary.get("summary_doctor_lang", ""),
                               "summary_patient_lang": summary.get("summary_patient_lang", ""),
                               "key_points_patient_lang": summary.get("key_points_patient_lang", [])})

    for i, m in enumerate(notes.get("medications", [])):
        docs["medications"].append({**common, "id": f"{vid}-m{i}", "source": m.get("source", "visit"),
                                    **{k: (m.get(k) or "") for k in ["name", "generic_name", "dose", "frequency",
                                                                       "purpose", "instructions", "change",
                                                                       "explanation_patient_lang"]}})
    for i, e in enumerate(notes.get("exercises", [])):
        docs["exercises"].append({**common, "id": f"{vid}-e{i}", "form_cues": e.get("form_cues") or [],
                                  **{k: (e.get(k) or "") for k in ["name", "body_part", "sets", "reps",
                                                                     "frequency", "explanation_patient_lang"]}})
    for i, ci in enumerate(notes.get("care_items", [])):
        docs["care_items"].append({**common, "id": f"{vid}-ci{i}", "status": "open", "source": ci.get("source", "visit"),
                                   **{k: (ci.get(k) or "") for k in ["type", "text", "text_patient_lang", "due"]}})
    # Questions the patient never got to ask -> carry over as open care items.
    for q in visit.get("questions", []):
        if q.get("status") == "open":
            docs["care_items"].append({**common, "id": f"{vid}-q{q['id']}", "type": "open_question",
                                       "text": q.get("text_doctor_lang") or q["text"],
                                       "text_patient_lang": q["text"], "due": "next visit",
                                       "status": "open", "source": "visit"})
    return docs


async def index_visit(visit: dict) -> dict[str, int]:
    """Upsert a finished visit. Returns counts per collection (or {} if Typesense is off)."""
    if not config.TYPESENSE_URL:
        return {}
    docs = build_documents(visit)
    counts = {}
    async with httpx.AsyncClient(base_url=config.TYPESENSE_URL, timeout=120,
                                 headers={"X-TYPESENSE-API-KEY": config.TYPESENSE_API_KEY}) as c:
        for coll, items in docs.items():
            if not items:
                continue
            body = "\n".join(json.dumps(d, ensure_ascii=False) for d in items)
            r = await c.post(f"/collections/{coll}/documents/import", params={"action": "upsert"},
                             content=body.encode(), headers={"Content-Type": "text/plain"})
            ok = sum(1 for line in r.text.splitlines() if '"success":true' in line)
            if ok < len(items):
                log.warning("typesense %s: %s", coll, r.text[:300])
            counts[coll] = ok
    return counts


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "setup":
        setup(reset="--reset" in sys.argv)
    else:
        print(__doc__)
