"""Hand-off to the rest of the AI Clinic Assistant (the "main app").

    GET  /api/patients/{patient_id}/context   -> everything the at-home side needs, in one call
    GET  /api/patients/{patient_id}/visits    -> list of past visits (with summaries)
    GET  /api/patients/{patient_id}/workout-plan -> exercise program (general format)
    GET  /api/patients/{patient_id}/pt-plan   -> the same, in the PT camera app's plan format (pt/js/plan.js)
    POST /api/pt/sessions?patient_id=...      <- the PT app sends each finished home session here
    GET  /api/patients/{patient_id}/pt-sessions -> summaries of home sessions
    GET  /api/patients/{patient_id}/dashboard -> everything the patient dashboard shows, in one call
    GET/POST/DELETE /api/patients/{patient_id}/questions -> questions saved for the next visit
    DELETE /api/patients/{patient_id}?confirm=yes -> erase this patient's demo data (if ALLOW_RESET)
    GET  /api/patients/{patient_id}/search?q=...  -> Typesense search across the patient's records
    POST /api/patients/{patient_id}/ask {"question": ...} -> plain-language answer built from search results
    GET  /api/visits/{visit_id}               -> one full visit (in main.py)
    POST <MAIN_APP_WEBHOOK_URL>               <- we send the full visit when it ends

The context endpoint also returns `prompt_context`: plain text you can drop straight
into the FaceTime agent's system prompt.
"""
from __future__ import annotations

import asyncio
import logging
import time

import json
import re
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request

import config
import exercise_library
import notes_merge
import storage

log = logging.getLogger("integration")
router = APIRouter()


def _patient_visits(patient_id: str) -> list[dict]:
    visits = [v for v in storage.load_all() if v.get("patient_id") == patient_id]
    return sorted(visits, key=lambda v: v.get("started_at", 0))


def _when(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts or 0))


def build_context(patient_id: str) -> dict:
    visits = _patient_visits(patient_id)
    if not visits:
        raise HTTPException(404, f"no saved visits for patient '{patient_id}'")

    # Newest information wins: walk visits oldest -> newest, keyed by name.
    meds: dict[str, dict] = {}
    exercises: dict[str, dict] = {}
    care: list[dict] = []
    open_questions: list[dict] = []
    for v in visits:
        base = {"visit_id": v["id"], "provider": v.get("provider", ""), "date": _when(v.get("started_at"))}
        notes = v.get("notes") or {}
        for m in notes.get("medications", []):
            key = (m.get("generic_name") or m.get("name") or "").lower()
            if m.get("change") == "stopped":
                meds.pop(key, None)
                meds[f"stopped:{key}"] = {**m, **base}
            else:
                meds.pop(f"stopped:{key}", None)
                meds[key] = {**m, **base}
        for e in notes_merge.active_exercises(notes):
            exercises[(e.get("name") or "").lower()] = {**e, **base}
        care += [{**c, **base} for c in notes.get("care_items", [])]
        open_questions = [{"text": q["text"], "text_doctor_lang": q.get("text_doctor_lang"), **base}
                          for q in v.get("questions", []) if q.get("status") == "open"] or open_questions

    current = [m for k, m in meds.items() if not k.startswith("stopped:")]
    stopped = [m for k, m in meds.items() if k.startswith("stopped:")]
    last = visits[-1]
    ctx = {
        "patient_id": patient_id,
        "patient_lang": last.get("patient_lang"),
        "doctor_lang": last.get("doctor_lang"),
        "visit_count": len(visits),
        "last_visit": {"visit_id": last["id"], "date": _when(last.get("started_at")),
                       "provider": last.get("provider", ""), "summary": last.get("summary")},
        "current_medications": current,
        "stopped_medications": stopped,
        "exercises": list(exercises.values()),
        "warning_signs": [c for c in care if c.get("type") == "warning_sign"],
        "follow_ups": [c for c in care if c.get("type") in ("follow_up", "test", "referral")],
        "instructions": [c for c in care if c.get("type") == "instruction"],
        "unasked_questions": open_questions,      # from the most recent visit that had any
    }
    ctx["home_exercise"] = session_summaries(patient_id, limit=10)
    ctx["workout_plan"] = next((p for p in (plan_from_visit(v) for v in reversed(visits)) if p), None)
    ctx["prompt_context"] = _prompt_text(ctx)
    return ctx


def _prompt_text(c: dict) -> str:
    """Compact plain-text version for an LLM agent's system prompt."""
    L = [f"Patient {c['patient_id']} (speaks {c['patient_lang']}). {c['visit_count']} recorded visit(s); "
         f"last on {c['last_visit']['date']} with {c['last_visit']['provider'] or 'their doctor'}."]
    s = (c["last_visit"].get("summary") or {}).get("summary_doctor_lang")
    if s:
        L.append(f"Last visit summary: {s}")
    if c["current_medications"]:
        L.append("Current medications:")
        for m in c["current_medications"]:
            what = " ".join(x for x in [m["name"], m.get("dose"), m.get("frequency")] if x)
            L.append(f"- {what} ({m.get('purpose') or 'purpose not stated'}; "
                     f"prescribed {m['date']} by {m['provider'] or 'their doctor'})")
    if c["stopped_medications"]:
        L.append("Stopped (do NOT take): " + ", ".join(m["name"] for m in c["stopped_medications"]))
    if c["exercises"]:
        L.append("Prescribed exercises:")
        for e in c["exercises"]:
            dose = ", ".join(x for x in [e.get("sets") and f"{e['sets']} sets", e.get("reps") and f"{e['reps']} reps",
                                         e.get("hold_seconds") and f"hold {e['hold_seconds']} s",
                                         e.get("duration_minutes") and f"{e['duration_minutes']} minutes",
                                         e.get("frequency"),
                                         e.get("side") in ("left", "right") and f"{e['side']} side only"] if x) \
                or "amount not stated"
            L.append(f"- {e['name']}: {dose}. Form cues: {'; '.join(e.get('form_cues') or []) or 'none given'}")
    prog = (c.get("workout_plan") or {}).get("program") or {}
    if prog.get("precautions"):
        L.append("Exercise precautions: " + "; ".join(prog["precautions"]))
    if prog.get("pain_stop_level") is not None:
        L.append(f"Stop exercising if pain is above {prog['pain_stop_level']}/10.")
    if prog.get("goals"):
        L.append("Therapy goals: " + "; ".join(prog["goals"]))
    if c.get("home_exercise"):
        L.append("Recent home exercise (camera-tracked):")
        for h in c["home_exercise"][:5]:
            L.append(f"- {h['at']}: {h['exercise']} ({h['side'] or '?'} side), {h['good_reps']}/{h['total_reps']} good reps, "
                     f"best angle {h['best_angle']}° (target {h['target']}°)"
                     + (f", pain {h['pain']}/10" if h.get("pain") is not None else "")
                     + (f", note: \"{h['note']}\"" if h.get("note") else ""))
    if c["follow_ups"]:
        L.append("Follow-ups: " + "; ".join(f"{f['text']} ({f.get('due') or 'no date'})" for f in c["follow_ups"]))
    if c["warning_signs"]:
        L.append("Warning signs (tell them to seek care): " + "; ".join(w["text"] for w in c["warning_signs"]))
    if c["unasked_questions"]:
        L.append("Questions they didn't get to ask: " + "; ".join(q["text"] for q in c["unasked_questions"]))
    L.append("Only use the information above about this patient. If unsure, tell them to ask their care team.")
    return "\n".join(L)


def _int(x):
    """'3' -> 3, '10 each side' -> 10, None/'' -> None."""
    if isinstance(x, int):
        return x
    digits = "".join(ch if ch.isdigit() else " " for ch in str(x or "")).split()
    return int(digits[0]) if digits else None


def plan_from_visit(v: dict) -> dict | None:
    """Turn one visit's exercise notes into a workout plan the PT app can load.
    Fields the therapist didn't mention stay null -> the PT app keeps its own defaults for those."""
    notes = v.get("notes") or {}
    exercises = notes_merge.active_exercises(notes)          # cancelled ones stay out of the plan
    if not exercises:
        return None
    therapy = notes.get("therapy") or {}
    out = []
    for i, e in enumerate(exercises):
        key = e.get("exercise_key") or "other"
        lib = exercise_library.LIBRARY.get(key, exercise_library.LIBRARY["other"])
        out.append({
            "order": i + 1,
            "key": key,
            "name": e.get("name") or lib["name"],
            "standard_name": lib["name"],
            "body_part": e.get("body_part") or lib["body_part"],
            "side": e.get("side"),
            "sets": e.get("sets_count") or _int(e.get("sets")),
            "reps": e.get("reps_count") or _int(e.get("reps")),
            "hold_seconds": e.get("hold_seconds"),
            "rest_seconds": e.get("rest_seconds"),
            "times_per_day": e.get("times_per_day"),
            "days_per_week": e.get("days_per_week"),
            "duration_minutes": e.get("duration_minutes"),
            "equipment": e.get("equipment"),
            "form_cues": e.get("form_cues") or [],
            "as_prescribed": ", ".join(x for x in [e.get("sets") and f"{e['sets']} sets",
                                                   e.get("reps") and f"{e['reps']} reps",
                                                   e.get("frequency")] if x),
            "explanation_patient_lang": e.get("explanation_patient_lang"),
            "tracking": exercise_library.tracking_for(key, e.get("limit_deg")),
        })
    return {
        "patient_id": v.get("patient_id"),
        "plan_id": v["id"],
        "created": _when(v.get("started_at")),
        "prescribed_by": v.get("provider") or "",
        "patient_lang": v.get("patient_lang"),
        "program": {
            "goals": therapy.get("goals") or [],
            "precautions": therapy.get("precautions") or [],
            "precautions_patient_lang": therapy.get("precautions_patient_lang") or [],
            "pain_stop_level": therapy.get("pain_stop_level"),
            "after_exercise": therapy.get("after_exercise"),
            "program_weeks": therapy.get("program_weeks"),
            "clinic_sessions_per_week": therapy.get("clinic_sessions_per_week"),
        },
        "exercises": out,
    }


def build_workout_plan(patient_id: str) -> dict:
    """Latest plan = the most recent visit that prescribed exercises."""
    for v in reversed(_patient_visits(patient_id)):
        plan = plan_from_visit(v)
        if plan:
            return plan
    raise HTTPException(404, f"no exercise plan yet for patient '{patient_id}'")


@router.get("/api/patients/{patient_id}/workout-plan")
async def workout_plan(patient_id: str):
    return await asyncio.to_thread(build_workout_plan, patient_id)


# ------------------------------------------------------------------ PT camera app format

def pt_plan_from_visit(v: dict) -> dict | None:
    """The visit's exercises in the PT app's DEMO_PLAN shape (+ optional fields its plan.js understands)."""
    plan = plan_from_visit(v)
    if not plan:
        return None
    prog = plan["program"]
    note_bits = []
    if prog.get("pain_stop_level") is not None:
        note_bits.append(f"Stop if pain goes above {prog['pain_stop_level']}/10.")
    if prog.get("after_exercise"):
        note_bits.append(prog["after_exercise"].rstrip(".") + ".")
    exercises, untracked = [], []
    for e in plan["exercises"]:
        m = exercise_library.PT_APP.get(e["key"])
        if m and m["id"] not in exercise_library.PT_APP_KNOWN:
            m = None                  # their library doesn't have it yet -> list it as untracked
        cues = ". ".join(c.rstrip(".") for c in e["form_cues"])
        if e.get("equipment"):
            cues = (cues + ". " if cues else "") + f"Use: {e['equipment']}"
        if not m:
            untracked.append({"name": e["name"], "as_prescribed": e["as_prescribed"]
                              or (f"{e['duration_minutes']} minutes" if e.get("duration_minutes") else ""),
                              "duration_minutes": e.get("duration_minutes"), "perDay": e.get("times_per_day"),
                              "instruction": cues or None})
            continue
        target, checks = exercise_library.pt_target_and_checks(m, e["tracking"].get("therapist_limit_deg"))
        item = {"id": m["id"], "mode": m["mode"],
                "side": e["side"] if e.get("side") in ("left", "right") else "auto",
                "reps": e.get("reps"), "target": target,
                "instruction": (cues + ".") if cues else None,
                "sets": e.get("sets"), "holdMs": e["hold_seconds"] * 1000 if e.get("hold_seconds") else None,
                "perDay": e.get("times_per_day"),
                "note": " ".join(note_bits) or None, "checks": checks,
                "prescribedAs": e["as_prescribed"], "name": e["name"]}
        exercises.append({k: val for k, val in item.items() if val not in (None, [], "")})
    return {
        "id": f"plan-{v['id']}",
        "therapist": v.get("provider") or "Your therapist",
        "createdAt": plan["created"],
        "patientId": v.get("patient_id"),
        "visitId": v["id"],
        "source": "during-visit",
        "program": prog,
        "exercises": exercises,
        "untracked": untracked,     # prescribed but not camera-trackable (e.g. walking)
    }


@router.get("/api/patients/{patient_id}/pt-plan")
async def pt_plan(patient_id: str):
    def latest():
        for v in reversed(_patient_visits(patient_id)):
            p = pt_plan_from_visit(v)
            if p:
                return p
        raise HTTPException(404, f"no exercise plan yet for patient '{patient_id}'")
    return await asyncio.to_thread(latest)


# ------------------------------------------------------------------ home sessions coming back

def _sessions_dir(patient_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", patient_id)[:80] or "unknown"
    return Path(config.DATA_DIR) / "pt_sessions" / safe


def _write_pt_session(pid: str, sid: str, body: dict) -> None:
    d = _sessions_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    body["_received_at"] = time.time()
    (d / f"{int(time.time())}-{re.sub(r'[^A-Za-z0-9_-]', '_', sid)[:40]}.json").write_text(
        json.dumps(body, ensure_ascii=False), encoding="utf-8")


@router.post("/api/pt/sessions")
async def receive_pt_session(request: Request, patient_id: str | None = None):
    """Accepts either the PT app's results JSON (app.js) or a SessionLog export (sessionLog.js/store.js)."""
    body = await request.json()
    pid = patient_id or body.get("patient_id") or body.get("patientId")
    plan_id = str(body.get("planId") or body.get("plan_id") or "")
    if not pid and plan_id.startswith("plan-"):
        # sessionLog.js records planId = the plan's id ("plan-<visit id>") -> look up whose visit it was
        v = await asyncio.to_thread(storage.load_visit, plan_id[len("plan-"):])
        pid = (v or {}).get("patient_id")
    if not pid:
        raise HTTPException(400, "patient_id is required (query parameter or in the body)")
    sid = str(body.get("id") or uuid.uuid4().hex[:12])
    await asyncio.to_thread(_write_pt_session, pid, sid, body)
    log.info("PT session for %s saved (%s)", pid, sid)
    return {"ok": True, "id": sid}


def session_summaries(patient_id: str, limit: int = 20) -> list[dict]:
    d = _sessions_dir(patient_id)
    out = []
    for p in sorted(d.glob("*.json"), reverse=True)[:limit] if d.exists() else []:
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        when = (s.get("recorded_at") or s.get("startedAt") or "")[:16].replace("T", " ")
        if "exercise_id" in s:      # app.js results format: one exercise
            items = [{"exercise": s.get("exercise"), "side": s.get("side"), "target": s.get("target_angle"),
                      "summary": s.get("summary") or {}}]
            pain, note = s.get("pain"), s.get("note")
        else:                       # sessionLog.js format: several exercises
            items = [{"exercise": e.get("name"), "side": e.get("side"), "target": e.get("target"),
                      "summary": e.get("summary") or {}} for e in s.get("exercises", [])]
            pain, note = (s.get("checkIn") or {}).get("pain"), (s.get("checkIn") or {}).get("note")
        for it in items:
            sm = it["summary"]
            out.append({"at": when, "exercise": it["exercise"], "side": it["side"], "target": it["target"],
                        "good_reps": sm.get("goodReps"), "total_reps": sm.get("totalReps"),
                        "best_angle": sm.get("bestPeakAngle"), "pain": pain, "note": note or ""})
    return out


@router.get("/api/patients/{patient_id}/pt-sessions")
async def pt_sessions(patient_id: str):
    return {"patient_id": patient_id, "sessions": await asyncio.to_thread(session_summaries, patient_id)}


# ------------------------------------------------------------------ questions for the next visit
# Questions the patient writes at home (dashboard) + ones they didn't get to ask at a visit.
# The visit copilot preloads them; after a visit, asked/answered ones are removed.

def _questions_file(patient_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", patient_id)[:80] or "unknown"
    return Path(config.DATA_DIR) / "questions" / f"{safe}.json"


def load_questions(patient_id: str) -> list[dict]:
    f = _questions_file(patient_id)
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    except Exception:
        return []


def save_questions(patient_id: str, qs: list[dict]):
    f = _questions_file(patient_id)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(qs, ensure_ascii=False, indent=2), encoding="utf-8")


def sync_questions_after_visit(record: dict):
    """After a visit: drop pending questions that got asked/answered; keep (or add) the unasked ones."""
    pid = record.get("patient_id")
    if not pid:
        return
    norm = lambda t: re.sub(r"\W+", " ", (t or "").lower()).strip()
    covered = {norm(q["text"]) for q in record.get("questions", []) if q.get("status") in ("asked", "answered")}
    pending = [q for q in load_questions(pid) if norm(q["text"]) not in covered]
    have = {norm(q["text"]) for q in pending}
    for q in record.get("questions", []):
        if q.get("status") == "open" and norm(q["text"]) not in have:
            pending.append({"id": uuid.uuid4().hex[:12], "text": q["text"], "source": "visit",
                            "visit_id": record["id"], "created": time.time()})
    save_questions(pid, pending)


@router.get("/api/patients/{patient_id}/questions")
async def get_questions(patient_id: str):
    return {"patient_id": patient_id, "questions": await asyncio.to_thread(load_questions, patient_id)}


@router.post("/api/patients/{patient_id}/questions")
async def add_question(patient_id: str, request: Request):
    body = await request.json()
    text = str(body.get("text") or "").strip()[:500]
    if not text:
        raise HTTPException(400, "text is required")
    q = {"id": str(body.get("id") or uuid.uuid4().hex[:12]), "text": text, "source": "home", "created": time.time()}
    qs = await asyncio.to_thread(load_questions, patient_id)
    qs = [x for x in qs if x["id"] != q["id"]] + [q]
    await asyncio.to_thread(save_questions, patient_id, qs)
    return q


@router.delete("/api/patients/{patient_id}/questions/{question_id}")
async def delete_question(patient_id: str, question_id: str):
    qs = await asyncio.to_thread(load_questions, patient_id)
    await asyncio.to_thread(save_questions, patient_id, [x for x in qs if x["id"] != question_id])
    return {"ok": True}


# ------------------------------------------------------------------ search + ask (Typesense)

async def _search(patient_id: str, q: str) -> dict:
    """Typesense first; if it's not configured or not reachable, the local fallback (labelled as such)."""
    import search_index
    try:
        return await search_index.search(patient_id, q)
    except Exception as e:
        if config.TYPESENSE_URL:
            log.warning("typesense search failed, using local search: %s", e)
        res = search_index.local_search(patient_id, q, await asyncio.to_thread(_patient_visits, patient_id))
        res["fallback_reason"] = "Typesense is not configured" if not config.TYPESENSE_URL else f"Typesense error: {str(e)[:120]}"
        return res


@router.get("/api/patients/{patient_id}/search")
async def search_records(patient_id: str, q: str = ""):
    if len(q) > 200:
        raise HTTPException(400, "query too long")
    return await _search(patient_id, q)


@router.post("/api/patients/{patient_id}/ask")
async def ask_records(patient_id: str, request: Request):
    import extract
    body = await request.json()
    question = str(body.get("question") or "").strip()[:300]
    if not question:
        raise HTTPException(400, "question is required")
    res = await _search(patient_id, question)
    order = ["medications", "exercises", "care_items", "visit_chunks", "visits"]
    hits = [h for c in order for h in res["groups"].get(c, [])]
    # most relevant first (Typesense's text_match score); collection order breaks ties
    sources = sorted(hits, key=lambda h: -(h.get("score") or 0))[:10]
    visits = await asyncio.to_thread(_patient_visits, patient_id)
    pat_lang = body.get("lang") or (visits[-1].get("patient_lang") if visits else "en")
    out = {"question": question, "engine": res["engine"], "sources": [], "answer": None, "found": False}
    if not sources:
        out["answer"] = "I couldn't find that in your visit notes. Please ask your care team."
        return out
    try:
        a = await extract.ask(question, sources, pat_lang)
        used = [n for n in a.source_numbers if 1 <= n <= len(sources)] or list(range(1, min(3, len(sources)) + 1))
        out.update(answer=a.answer, found=a.found, sources=[{"n": n, **sources[n - 1]} for n in used])
    except Exception as e:                       # Gemini down / over quota: still show what search found
        log.warning("ask failed: %s", e)
        out.update(answer=None, error="The answer service is busy. Here is what your records say:",
                   sources=[{"n": i + 1, **s} for i, s in enumerate(sources[:4])])
    return out


# ------------------------------------------------------------------ reset (demo)

TS_COLLECTIONS = ["visit_chunks", "visits", "medications", "exercises", "care_items"]


def reset_patient(patient_id: str) -> dict:
    """Erase everything stored for one patient: visit backups, saved questions, home sessions, Typesense docs."""
    removed = {"visits": 0, "questions": 0, "pt_sessions": 0, "typesense": {}}
    for p in (storage.VISITS_DIR.glob("*.json") if storage.VISITS_DIR.exists() else []):
        try:
            if json.loads(p.read_text(encoding="utf-8")).get("patient_id") == patient_id:
                p.unlink(); removed["visits"] += 1
        except Exception:
            pass
    qf = _questions_file(patient_id)
    if qf.exists():
        removed["questions"] = len(load_questions(patient_id)); qf.unlink()
    sd = _sessions_dir(patient_id)
    if sd.exists():
        for p in sd.glob("*.json"):
            p.unlink(); removed["pt_sessions"] += 1
        sd.rmdir()
    if config.TYPESENSE_URL:
        with httpx.Client(base_url=config.TYPESENSE_URL, timeout=30,
                          headers={"X-TYPESENSE-API-KEY": config.TYPESENSE_API_KEY}) as c:
            for coll in TS_COLLECTIONS:
                try:
                    r = c.delete(f"/collections/{coll}/documents",
                                 params={"filter_by": f"patient_id:=`{patient_id}`"})
                    removed["typesense"][coll] = r.json().get("num_deleted", 0) if r.is_success else f"error {r.status_code}"
                except Exception as e:
                    removed["typesense"][coll] = f"error: {e}"
    log.info("reset patient %s: %s", patient_id, removed)
    return removed


@router.delete("/api/patients/{patient_id}")
async def reset_patient_api(patient_id: str, confirm: str = ""):
    if not config.ALLOW_RESET:
        raise HTTPException(403, "reset is turned off (ALLOW_RESET=false)")
    if confirm != "yes":
        raise HTTPException(400, "add ?confirm=yes to erase this patient's data")
    return {"patient_id": patient_id, "removed": await asyncio.to_thread(reset_patient, patient_id)}


# ------------------------------------------------------------------ patient dashboard

def build_dashboard(patient_id: str) -> dict:
    visits = _patient_visits(patient_id)
    last = visits[-1] if visits else {}
    out = {"patient_id": patient_id, "has_visits": bool(visits), "clinician": None, "pt_plan": None,
           "patient_lang": last.get("patient_lang"), "doctor_lang": last.get("doctor_lang"),
           "medications": [], "stopped_medications": [], "appointments": [], "warning_signs": [],
           "questions": load_questions(patient_id), "home_sessions": session_summaries(patient_id, limit=30)}
    if not visits:
        return out
    ctx = build_context(patient_id)
    out["pt_plan"] = next((p for p in (pt_plan_from_visit(v) for v in reversed(visits)) if p), None)
    named = (out["pt_plan"] or {}).get("therapist")
    out["clinician"] = (named if named and named != "Your therapist" else None) or ctx["last_visit"]["provider"] or None
    out["patient_lang"], out["doctor_lang"] = ctx.get("patient_lang"), ctx.get("doctor_lang")
    slim = lambda m: {k: m.get(k) for k in ("name", "dose", "frequency", "purpose", "instructions",
                                            "explanation_patient_lang", "provider", "date")}
    out["medications"] = [slim(m) for m in ctx["current_medications"]]
    out["stopped_medications"] = [slim(m) for m in ctx["stopped_medications"]]
    out["appointments"] = [{"text": f["text"], "text_patient_lang": f.get("text_patient_lang"), "due": f.get("due"),
                            "type": f.get("type"), "provider": f.get("provider"), "from_visit": f.get("date")}
                           for f in ctx["follow_ups"]]
    out["warning_signs"] = [{"text": w["text"], "text_patient_lang": w.get("text_patient_lang")} for w in ctx["warning_signs"]]
    return out


@router.get("/api/patients/{patient_id}/dashboard")
async def dashboard(patient_id: str):
    return await asyncio.to_thread(build_dashboard, patient_id)


@router.get("/api/patients/{patient_id}/context")
async def patient_context(patient_id: str):
    return await asyncio.to_thread(build_context, patient_id)


@router.get("/api/patients/{patient_id}/visits")
async def patient_visits(patient_id: str):
    visits = await asyncio.to_thread(_patient_visits, patient_id)
    return {"patient_id": patient_id, "visits": [
        {"visit_id": v["id"], "date": _when(v.get("started_at")), "provider": v.get("provider", ""),
         "patient_lang": v.get("patient_lang"), "summary": v.get("summary")} for v in reversed(visits)]}


async def notify_main_app(record: dict):
    """POST the finished visit to the main app's webhook, if one is configured."""
    if not config.MAIN_APP_WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(config.MAIN_APP_WEBHOOK_URL, json={"event": "visit.ended", "visit": record,
                                                                "workout_plan": plan_from_visit(record)})
        log.info("webhook -> %s: %s", config.MAIN_APP_WEBHOOK_URL, r.status_code)
    except Exception as e:
        log.warning("webhook failed: %s", e)