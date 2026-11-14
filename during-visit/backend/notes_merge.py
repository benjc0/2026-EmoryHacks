"""Merge each new notes update into the notes so far, instead of replacing them.

Every ~30 s Gemini re-reads the transcript and returns the visit's notes. A single update can leave things out
(a lighter model, a rate-limit fallback, a long transcript), so replacing the notes made exercises and medicines
disappear. Instead:

  - items in the new update UPDATE the matching item (same exercise / medicine / instruction); a field the
    update leaves empty keeps its earlier value
  - items only in the new update are ADDED
  - items the update left out are KEPT; they're only removed when the clinician cancels them
    (exercise: cancelled=true; medicine: change="stopped" is kept as a visible "stopped" entry)
"""
from __future__ import annotations

import difflib
import re

EMPTY = (None, "", [], {})


def _norm(s) -> str:
    return re.sub(r"[^\w]+", " ", str(s or "").lower()).strip()


def _similar(a: str, b: str, cutoff: float = 0.78) -> bool:
    return bool(a and b) and difflib.SequenceMatcher(None, a, b).ratio() >= cutoff


# How to recognise "the same item" in two updates: an exact key, and a text to compare when keys differ.
def _ex_key(e):   # same standard exercise (unless "other"), else same name
    k = e.get("exercise_key")
    return ("key", k, e.get("side") or "") if k and k != "other" else ("name", _norm(e.get("name")))


def _med_key(m):
    return ("med", _norm(m.get("generic_name") or m.get("name")))


def _care_key(c):
    return ("care", c.get("type"), _norm(c.get("text"))[:60])


def _diag_key(d):
    return ("diag", _norm(d.get("name")))


SECTIONS = {
    "exercises": (_ex_key, lambda e: _norm(e.get("name"))),
    "medications": (_med_key, lambda m: _norm(m.get("generic_name") or m.get("name"))),
    "care_items": (_care_key, lambda c: f"{c.get('type')} {_norm(c.get('text'))}"),
    "diagnoses": (_diag_key, lambda d: _norm(d.get("name"))),
}
STICKY_TRUE = {"cancelled"}   # once the clinician cancelled it, a later update that forgets this doesn't undo it


def _merge_item(old: dict, new: dict) -> dict:
    out = dict(old)
    for k, v in new.items():
        if k in STICKY_TRUE:
            out[k] = bool(old.get(k)) or bool(v)
        elif v not in EMPTY:
            out[k] = v
    return out


def _fuzzy_ok(a: dict, b: dict) -> bool:
    """Compare by wording only when the exact key can't decide: two standard exercises with different keys
    or sides (left vs right knee) are different exercises, however similar their names."""
    std = lambda e: e.get("exercise_key") not in (None, "", "other")
    return not (std(a) and std(b))


def merge_list(old: list[dict], new: list[dict], key, text) -> list[dict]:
    result = [dict(o) for o in old]
    for n in new:
        idx = next((i for i, o in enumerate(result) if key(o) == key(n)), None)
        if idx is None:   # same thing worded a little differently? ("Mini squats" vs "Mini squat")
            idx = next((i for i, o in enumerate(result) if _fuzzy_ok(o, n) and _similar(text(o), text(n))), None)
        if idx is None:
            result.append(dict(n))
        else:
            result[idx] = _merge_item(result[idx], n)
    return result


def _merge_therapy(old: dict | None, new: dict | None) -> dict | None:
    if not old:
        return new
    if not new:
        return old
    out = dict(old)
    for k, v in new.items():
        if isinstance(v, list):
            seen = {_norm(x) for x in out.get(k) or []}
            out[k] = list(out.get(k) or []) + [x for x in v if _norm(x) not in seen]
        elif v not in EMPTY:
            out[k] = v
    return out


def merge_notes(old: dict | None, new: dict) -> dict:
    """old = notes so far (may be empty), new = the latest update. Returns the merged notes."""
    if not old:
        return new
    out = dict(new)
    for section, (key, text) in SECTIONS.items():
        out[section] = merge_list(old.get(section) or [], new.get(section) or [], key, text)
    out["therapy"] = _merge_therapy(old.get("therapy"), new.get("therapy"))
    out["wrapping_up"] = bool(new.get("wrapping_up"))
    return out


def active_exercises(notes: dict) -> list[dict]:
    """Exercises still prescribed (cancelled ones are kept in the record but left out of plans)."""
    return [e for e in (notes or {}).get("exercises") or [] if not e.get("cancelled")]
