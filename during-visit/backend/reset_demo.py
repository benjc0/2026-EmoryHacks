"""Erase demo data before judging (or between rehearsals).

    python reset_demo.py kim-001        erase one patient
    python reset_demo.py --all          erase every patient's visits, questions and home sessions,
                                        and empty the Typesense collections

Stop the server first if you use --all, so nothing is being written at the same time.
"""
import json
import shutil
import sys
from pathlib import Path

import config
import integration
import storage


def all_patients() -> set[str]:
    ids = set()
    for p in (storage.VISITS_DIR.glob("*.json") if storage.VISITS_DIR.exists() else []):
        try:
            ids.add(json.loads(p.read_text(encoding="utf-8")).get("patient_id") or "")
        except Exception:
            pass
    return {i for i in ids if i}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--all":
        if input(f"Erase ALL demo data in {config.DATA_DIR} and Typesense? Type yes: ").strip().lower() != "yes":
            sys.exit("Cancelled.")
        for pid in sorted(all_patients()):
            print(pid, integration.reset_patient(pid))
        for sub in ("visits", "questions", "pt_sessions"):           # leftovers without a patient id
            shutil.rmtree(Path(config.DATA_DIR) / sub, ignore_errors=True)
        print("Done. Everything is empty.")
    else:
        print(integration.reset_patient(sys.argv[1]))


if __name__ == "__main__":
    main()
