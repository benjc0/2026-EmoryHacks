"""Hand-off to the rest of the AI Clinic Assistant (the "main app").

    GET  /api/patients/{patient_id}/context   -> everything the at-home side needs, in one call
    GET  /api/patients/{patient_id}/visits    -> list of past visits (with summaries)
    GET  /api/patients/{patient_id}/workout-plan -> exercise program (general format)
    GET  /api/patients/{patient_id}/pt-plan   -> the same, in the PT camera app's plan format (pt/js/plan.js)
    POST /api/pt/sessions?patient_id=...      <- the PT app sends each finished home session here
    GET  /api/patients/{patient_id}/pt-sessions -> summaries of home sessions
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
        for e in notes.get("exercises", []):
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
    exercises = notes.get("exercises") or []
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
    d = _sessions_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    body["_received_at"] = time.time()
    (d / f"{int(time.time())}-{re.sub(r'[^A-Za-z0-9_-]', '_', sid)[:40]}.json").write_text(
        json.dumps(body, ensure_ascii=False), encoding="utf-8")
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