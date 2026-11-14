# During Visit

Live interpreter and visit copilot (plain HTML/JS frontend, Python FastAPI backend, Gemini Live, Typesense).

Put the During Visit code in this folder. After Visit (the patient dashboard and at-home PT sessions) lives in `../after-visit/`, and the shared design system in `../design-system/`.

When a visit ends, the plan it produces (exercises, targets, instructions) is what After Visit reads. The format After Visit expects is `DEMO_PLAN` in `after-visit/js/plan.js`.
