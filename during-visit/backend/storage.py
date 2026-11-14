"""Backup copy of every visit as a JSON file (backend/data/visits/<visit_id>.json).

Typesense is the search layer; these files are the source of truth. If Typesense is
down, misconfigured or reset, rebuild it with:
    python search_index.py reindex
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import config

log = logging.getLogger("storage")
VISITS_DIR = Path(config.DATA_DIR) / "visits"


def save_visit(record: dict) -> Path:
    """Write the visit atomically (temp file + rename) so a crash never leaves half a file."""
    VISITS_DIR.mkdir(parents=True, exist_ok=True)
    path = VISITS_DIR / f"{record['id']}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return path


def load_visit(visit_id: str) -> dict | None:
    path = VISITS_DIR / f"{visit_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_all() -> list[dict]:
    if not VISITS_DIR.exists():
        return []
    out = []
    for p in sorted(VISITS_DIR.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception as e:
            log.warning("skipping unreadable %s: %s", p.name, e)
    return out