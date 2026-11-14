"""Typesense collections shared with the rest of the team, plus indexing of a finished visit.

Run once to create collections + synonyms:
    python search_index.py setup          (add --reset to drop and recreate)
Rebuild Typesense from the JSON backups in backend/data/visits:
    python search_index.py reindex
Update only the synonyms (after editing SYNONYMS):
    python search_index.py synonyms

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


# Synonyms. Two kinds:
#  - one-way ("root"): a category word also finds the specific terms, e.g. "blood thinner" -> apixaban,
#    but searching "apixaban" does NOT return every blood thinner.
#  - two-way: same meaning, usually English <-> Korean ("knee" <-> "무릎").
SYNONYMS = [
    # one-way: everyday category word -> specific medicines
    {"id": "blood-thinner", "root": "blood thinner", "synonyms": ["apixaban", "eliquis", "warfarin", "coumadin", "rivaroxaban", "xarelto", "anticoagulant"]},
    {"id": "blood-thinner-ko", "root": "혈액 희석제", "synonyms": ["apixaban", "eliquis", "warfarin", "anticoagulant", "항응고제"]},
    {"id": "painkiller", "root": "painkiller", "synonyms": ["ibuprofen", "advil", "acetaminophen", "tylenol", "meloxicam", "naproxen", "analgesic"]},
    {"id": "pain-medicine", "root": "pain medicine", "synonyms": ["ibuprofen", "advil", "acetaminophen", "tylenol", "meloxicam", "naproxen"]},
    {"id": "painkiller-ko", "root": "진통제", "synonyms": ["ibuprofen", "acetaminophen", "tylenol", "meloxicam", "멜록시캄"]},
    {"id": "bp-medicine", "root": "blood pressure medicine", "synonyms": ["lisinopril", "amlodipine", "losartan", "metoprolol"]},
    {"id": "diabetes-medicine", "root": "diabetes medicine", "synonyms": ["metformin", "insulin"]},
    {"id": "antibiotic", "root": "antibiotic", "synonyms": ["amoxicillin", "azithromycin", "cephalexin", "항생제"]},
    {"id": "heart-rhythm", "root": "irregular heartbeat", "synonyms": ["atrial fibrillation", "afib", "fluttering", "arrhythmia"]},
    {"id": "blood-clot", "root": "blood clot", "synonyms": ["dvt", "calf pain", "swollen calf", "혈전"]},
    # two-way: same meaning (mostly English <-> Korean)
    {"id": "knee", "synonyms": ["knee", "knees", "무릎"]},
    {"id": "shoulder", "synonyms": ["shoulder", "어깨"]},
    {"id": "back", "synonyms": ["back", "lower back", "허리"]},
    {"id": "leg", "synonyms": ["leg", "legs", "다리"]},
    {"id": "heart", "synonyms": ["heart", "cardiac", "심장"]},
    {"id": "blood-pressure", "synonyms": ["blood pressure", "hypertension", "bp", "혈압", "고혈압"]},
    {"id": "diabetes", "synonyms": ["diabetes", "blood sugar", "glucose", "당뇨", "혈당"]},
    {"id": "medicine", "synonyms": ["medicine", "medication", "pill", "drug", "약"]},
    {"id": "exercise", "synonyms": ["exercise", "exercises", "workout", "운동"]},
    {"id": "squat", "synonyms": ["squat", "squats", "스쿼트"]},
    {"id": "walk", "synonyms": ["walk", "walking", "걷기", "보행기", "walker"]},
    {"id": "stairs", "synonyms": ["stairs", "steps", "계단"]},
    {"id": "ice", "synonyms": ["ice", "icing", "cold pack", "얼음", "얼음찜질"]},
    {"id": "pain", "synonyms": ["pain", "hurt", "hurts", "sore", "통증", "아파요", "아프"]},
    {"id": "swelling", "synonyms": ["swelling", "swollen", "부기", "붓"]},
    {"id": "dizzy", "synonyms": ["dizzy", "dizziness", "lightheaded", "어지러움", "어지러"]},
    {"id": "follow-up", "synonyms": ["follow up", "follow-up", "next appointment", "next visit", "appointment", "다음 예약", "재방문", "예약", "진료"]},
    {"id": "side-effect", "synonyms": ["side effect", "side effects", "adverse effect", "부작용"]},
    {"id": "emergency", "synonyms": ["emergency", "911", "urgent", "응급", "바로 오세요"]},
    {"id": "surgery", "synonyms": ["surgery", "operation", "replacement", "수술"]},
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


def push_synonyms():
    """Update just the synonyms (after editing SYNONYMS) without touching collections or data."""
    with _client() as c:
        if _major_version(c) >= 30:
            r = c.put(f"/synonym_sets/{SYNONYM_SET}", json={"items": SYNONYMS})
            print("synonym set:", r.status_code, "" if r.is_success else r.text[:200])
        else:
            for s in schemas():
                for syn in SYNONYMS:
                    body = {"synonyms": syn["synonyms"], **({"root": syn["root"]} if syn.get("root") else {})}
                    c.put(f"/collections/{s['name']}/synonyms/{syn['id']}", json=body)
            print("synonyms updated on", len(schemas()), "collections")


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
                    body = {"synonyms": syn["synonyms"], **({"root": syn["root"]} if syn.get("root") else {})}
                    c.put(f"/collections/{s['name']}/synonyms/{syn['id']}", json=body)


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
    for i, e in enumerate(e for e in notes.get("exercises", []) if not e.get("cancelled")):
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


def reindex():
    """Load every saved visit from the JSON backup into Typesense."""
    import asyncio
    import storage
    if not config.TYPESENSE_URL:
        sys.exit("Set TYPESENSE_HOST and TYPESENSE_API_KEY first (see .env.example).")
    visits = storage.load_all()
    if not visits:
        print(f"No saved visits in {storage.VISITS_DIR}")
        return
    for v in visits:
        counts = asyncio.run(index_visit(v))
        print(f"{v['id']} ({v.get('provider') or 'no provider'}): {counts}")
    print(f"Reindexed {len(visits)} visit(s).")


# ---------------------------------------------------------------- search
# One multi_search across every collection, always filtered to one patient. Uses Typesense's typo tolerance,
# synonyms, prefix matching (search-as-you-type) and highlighting; adds meaning-based (vector) search on the
# transcript collections when an embedding model is configured.

SEARCH_SPEC = {
    "medications": {"query_by": "name,generic_name,purpose,instructions,explanation_patient_lang", "weights": "4,4,2,1,1", "per_page": 4},
    "exercises":   {"query_by": "name,body_part,form_cues,explanation_patient_lang",              "weights": "4,3,1,1",   "per_page": 4},
    "care_items":  {"query_by": "text,text_patient_lang,due",                                      "weights": "3,3,1",     "per_page": 4},
    "visits":      {"query_by": "summary_doctor_lang,summary_patient_lang,key_points_patient_lang", "weights": "2,2,2",    "per_page": 3},
    "visit_chunks": {"query_by": "text_doctor_lang,text_patient_lang,text",                         "weights": "2,2,1",     "per_page": 5},
}
_SEMANTIC = {"visits", "visit_chunks", "exercises"}   # collections with an embedding field (when enabled)


def _marked(snippet: str) -> str:
    """Typesense snippet -> safe HTML: escape everything, keep only its <mark> tags."""
    import html as _html
    out, rest = [], snippet or ""
    while "<mark>" in rest:
        before, _, rest = rest.partition("<mark>")
        word, _, rest = rest.partition("</mark>")
        out += [_html.escape(before), "<mark>", _html.escape(word), "</mark>"]
    out.append(_html.escape(rest))
    return "".join(out)


def _best_snippet(hit: dict, fields: list[str]) -> str:
    hl = hit.get("highlight") or {}
    for f in fields:                      # v0.25+ structured highlight
        h = hl.get(f)
        if isinstance(h, dict) and "<mark>" in (h.get("snippet") or ""):
            return h["snippet"]
        if isinstance(h, list):
            for x in h:
                if isinstance(x, dict) and "<mark>" in (x.get("snippet") or ""):
                    return x["snippet"]
    for h in hit.get("highlights") or []:  # older flat highlights
        if h.get("snippet"):
            return h["snippet"]
        if h.get("snippets"):
            return h["snippets"][0]
    return ""


def _shape(coll: str, doc: dict, snippet: str, score=None) -> dict:
    """One result, the same shape whatever collection it came from."""
    when = time.strftime("%Y-%m-%d", time.localtime(doc.get("date") or 0)) if doc.get("date") else ""
    base = {"collection": coll, "id": doc.get("id"), "visit_id": doc.get("visit_id"), "date": when,
            "provider": doc.get("provider") or "", "score": score}
    if coll == "medications":
        title = " ".join(x for x in [doc.get("name"), doc.get("dose")] if x)
        detail = " · ".join(x for x in [doc.get("frequency"), doc.get("purpose")] if x)
        extra = doc.get("explanation_patient_lang") or ""
    elif coll == "exercises":
        title = doc.get("name") or "Exercise"
        detail = " · ".join(x for x in [doc.get("sets") and f"{doc['sets']} sets", doc.get("reps") and f"{doc['reps']} reps",
                                         doc.get("frequency")] if x)
        extra = "; ".join(doc.get("form_cues") or [])
    elif coll == "care_items":
        kind = {"warning_sign": "Warning sign", "follow_up": "Follow-up", "test": "Test", "referral": "Referral",
                "instruction": "Instruction", "open_question": "Question to ask"}.get(doc.get("type"), "To do")
        title, detail, extra = kind, doc.get("text") or "", doc.get("text_patient_lang") or ""
        if doc.get("due"):
            detail += f" ({doc['due']})"
    elif coll == "visits":
        title = "Visit summary" + (f" · {doc['provider']}" if doc.get("provider") else "")
        detail, extra = doc.get("summary_doctor_lang") or "", doc.get("summary_patient_lang") or ""
    else:  # visit_chunks
        sec = int(doc.get("start_sec") or 0)
        title = f"What was said at {sec // 60:02d}:{sec % 60:02d}"
        detail, extra = doc.get("text_doctor_lang") or doc.get("text") or "", doc.get("text_patient_lang") or ""
        base["start_sec"] = sec
    return {**base, "title": title, "detail": detail, "extra": extra,
            "snippet_html": _marked(snippet) if snippet else ""}


async def search(patient_id: str, q: str, collections: list[str] | None = None) -> dict:
    """Search one patient's records in Typesense. Raises if Typesense isn't configured/reachable."""
    if not config.TYPESENSE_URL:
        raise RuntimeError("Typesense is not configured")
    q = (q or "").strip() or "*"
    semantic = config.TYPESENSE_EMBED_MODEL.lower() != "off"
    colls = [c for c in (collections or SEARCH_SPEC) if c in SEARCH_SPEC]
    searches = []
    for c in colls:
        spec = SEARCH_SPEC[c]
        query_by, weights = spec["query_by"], spec["weights"]
        if semantic and c in _SEMANTIC and q != "*":
            query_by, weights = query_by + ",embedding", weights + ",1"   # hybrid: keywords + meaning
        searches.append({
            "collection": c, "q": q, "query_by": query_by, "query_by_weights": weights,
            "filter_by": f"patient_id:=`{patient_id}`",
            "per_page": spec["per_page"], "num_typos": 2, "prefix": "true",
            "drop_tokens_threshold": 1,          # long questions: drop words until something matches
            "highlight_full_fields": spec["query_by"], "highlight_affix_num_tokens": 8,
            "exclude_fields": "embedding", "sort_by": "_text_match:desc,date:desc" if q != "*" else "date:desc",
        })
    t0 = time.time()
    async with httpx.AsyncClient(base_url=config.TYPESENSE_URL, timeout=15,
                                 headers={"X-TYPESENSE-API-KEY": config.TYPESENSE_API_KEY}) as c:
        r = await c.post("/multi_search", json={"searches": searches})
    r.raise_for_status()
    groups, total = {}, 0
    for c, res in zip(colls, r.json().get("results", [])):
        if res.get("error"):
            log.warning("typesense search %s: %s", c, res["error"])
            continue
        fields = SEARCH_SPEC[c]["query_by"].split(",")
        hits = [_shape(c, h["document"], _best_snippet(h, fields), h.get("text_match")) for h in res.get("hits", [])]
        if hits:
            groups[c] = hits
            total += res.get("found", len(hits))
    return {"query": q, "engine": "typesense", "semantic": semantic, "groups": groups, "total": total,
            "took_ms": int((time.time() - t0) * 1000)}


def local_search(patient_id: str, q: str, visits: list[dict]) -> dict:
    """Fallback when Typesense is unreachable: plain matching over the backup files (+ the same synonyms)."""
    import difflib
    import html as _html
    import re as _re
    q = (q or "").strip()
    words = [w for w in _re.findall(r"\w+", q.lower()) if len(w) > 1]
    terms = set(words) | ({q.lower()} if q else set())
    for syn in SYNONYMS:                       # expand with the same synonyms Typesense uses
        group = [s.lower() for s in syn["synonyms"]]
        root = (syn.get("root") or "").lower()
        if root and root in q.lower():
            terms |= set(group)
        elif not root and any(g in q.lower() for g in group):
            terms |= set(group)

    def hit(text: str) -> str:
        t = text or ""
        low = t.lower()
        found = [x for x in terms if x and x in low]
        if not found:                          # small typos: compare words
            toks = _re.findall(r"\w+", low)
            for w in words:
                if len(w) >= 5 and difflib.get_close_matches(w, toks, n=1, cutoff=0.8):
                    found.append(difflib.get_close_matches(w, toks, n=1, cutoff=0.8)[0])
        if not found:
            return ""
        # one pass, longest terms first, so "squats" isn't marked twice
        pat = _re.compile("|".join(_re.escape(x) for x in sorted(set(found), key=len, reverse=True)), _re.I)
        m = pat.search(t)
        if m and len(t) > 220:                 # show the part around the first match, not the start
            a = max(0, m.start() - 90); b = min(len(t), m.end() + 130)
            t = ("…" if a else "") + t[a:b] + ("…" if b < len(t) else "")
        parts, last = [], 0
        for m in pat.finditer(t):
            parts += [_html.escape(t[last:m.start()]), "<mark>", _html.escape(m.group(0)), "</mark>"]
            last = m.end()
        parts.append(_html.escape(t[last:]))
        return "".join(parts)

    groups: dict[str, list] = {}
    for v in visits:
        if v.get("patient_id") != patient_id:
            continue
        for coll, docs in build_documents(v).items():
            fields = SEARCH_SPEC[coll]["query_by"].split(",")
            for d in docs:
                for f in fields:
                    val = d.get(f)
                    val = "; ".join(val) if isinstance(val, list) else val
                    snip = hit(val or "")
                    if snip:
                        r = _shape(coll, d, "")
                        r["snippet_html"] = snip
                        groups.setdefault(coll, []).append(r)
                        break
    for k in groups:
        groups[k] = groups[k][: SEARCH_SPEC[k]["per_page"]]
    return {"query": q, "engine": "local", "semantic": False, "groups": groups,
            "total": sum(len(x) for x in groups.values()), "took_ms": 0}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup":
        setup(reset="--reset" in sys.argv)
    elif cmd == "reindex":
        reindex()
    elif cmd == "synonyms":
        push_synonyms()
    else:
        print(__doc__)