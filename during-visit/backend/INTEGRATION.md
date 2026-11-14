# Connecting the main app to Visit Copilot (the in-visit part)

Visit Copilot records the doctor's visit (interpreter, notes, questions, summary). Here's how the rest of
the AI Clinic Assistant gets that data. **Use whichever fits your code. You don't need all four.**

`VISIT_COPILOT_URL` below is wherever the Visit Copilot server runs, e.g. `http://localhost:8000` on the same
laptop, or the https tunnel / Coder / Vultr URL.

Every visit belongs to a **`patient_id`**. Use the same ID the main app uses for that patient.

---

## 1. Open Visit Copilot from the main app (link in)

Add a "Start doctor's visit" button that opens this link. Everything after `?` is optional:

```
VISIT_COPILOT_URL/?patient_id=p123
  &patient_lang=ko                 (patient's language: ko, en, es, zh, vi, ...)
  &doctor_lang=en
  &provider=Dr.%20Lee
  &q=Does%20this%20medicine%20have%20side%20effects%3F      (repeat q= for each question)
  &q=When%20can%20he%20play%20soccer%3F
  &return_url=https://your-main-app/home
```

- The patient's questions (from the main app's checklist) are filled in automatically.
- When the visit ends, a **"Back to the app"** button goes to `return_url?visit_id=<id>`.
- URL-encode the values (`encodeURIComponent` in JS, `urllib.parse.quote` in Python).

## 2. Get everything about a patient in one call (best for the FaceTime agent)

```
GET VISIT_COPILOT_URL/api/patients/p123/context
```

Returns the patient's latest state across all their visits:

```json
{
  "patient_id": "p123",
  "patient_lang": "ko",
  "last_visit": { "visit_id": "...", "date": "2026-11-14", "provider": "Dr. Lee", "summary": { ... } },
  "current_medications": [ { "name": "meloxicam", "dose": "7.5 mg", "frequency": "once daily with food",
                             "explanation_patient_lang": "...", "provider": "Dr. Lee", "date": "2026-11-14" } ],
  "stopped_medications": [ ... ],
  "exercises": [ { "name": "Quad sets", "sets": "3", "reps": "10", "form_cues": ["keep knee flat"] } ],
  "follow_ups": [ ... ], "warning_signs": [ ... ], "instructions": [ ... ],
  "unasked_questions": [ { "text": "이 약에 부작용이 있나요?", "text_doctor_lang": "Does this medicine have side effects?" } ],
  "prompt_context": "Patient p123 (speaks ko)... Current medications: ... Prescribed exercises: ..."
}
```

**`prompt_context` is ready-made text for an AI agent's system prompt.** Paste it in, and the FaceTime
agent knows the patient's medicines, exercises (with form cues to coach), warning signs and unasked questions.

Other endpoints:
- `GET /api/patients/p123/visits`: list of past visits with summaries (for a dashboard/history page)
- `GET /api/visits/<visit_id>`: one full visit: transcript, notes, questions, summary

Returns `404` if the patient has no saved visits yet. Calls from a browser are allowed (CORS is open).

## 2b. Workout plan for the physical-therapy / pose-tracking part

```
GET VISIT_COPILOT_URL/api/patients/p123/workout-plan
```

Replaces the PT part's **default** workout with what the therapist actually prescribed in the most recent
visit that had exercises. **Fields the therapist didn't mention are `null`: keep your defaults for those.**

```json
{
  "patient_id": "kim-001", "plan_id": "<visit id>", "created": "2026-11-14", "prescribed_by": "Sarah (PT)",
  "patient_lang": "ko",
  "program": {
    "goals": ["Bend knee to 110 degrees in 6 weeks"],
    "precautions": ["Don't kneel for 2 weeks", "Don't bend past 90 degrees in heel slides"],
    "precautions_patient_lang": ["2주 동안 무릎 꿇지 않기", "..."],
    "pain_stop_level": 5, "after_exercise": "Ice 15 minutes", "program_weeks": 6, "clinic_sessions_per_week": 2
  },
  "exercises": [
    {
      "order": 1, "key": "heel_slide", "name": "Heel slides", "body_part": "knee", "side": "left",
      "sets": 2, "reps": 15, "hold_seconds": 5, "rest_seconds": null, "times_per_day": 3, "days_per_week": null,
      "duration_minutes": null, "equipment": null,
      "form_cues": ["slide heel toward you", "hold 5 seconds"],
      "explanation_patient_lang": "누워서 왼쪽 발뒤꿈치를...",
      "tracking": {
        "joint": "knee", "measure": "knee flexion lying down", "camera": "side", "rep_type": "range",
        "target_deg": [170, 90],            // one rep = joint angle goes from 170 to 90 and back (180 = straight)
        "therapist_limit_deg": 90,
        "min_joint_angle_deg": 90           // warn if the knee angle drops below this
      }
    }
  ]
}
```

- **`key`** is always one of the standard exercises in `backend/exercise_library.py` (heel_slide, quad_set,
  straight_leg_raise, mini_squat, sit_to_stand, shoulder_flexion, walking, ... or `other`). Map these keys to
  your app's exercises once.
- **`tracking`** tells a pose tracker (MediaPipe etc.) which joint to measure, the angle range for one rep, the
  best camera view, and the therapist's limit. Angles are what the camera sees: for knee/hip/elbow, 180 =
  straight; for shoulder raises, 0 = arm at rest. `rep_type`: `range` (count reps between angles), `hold`
  (time a held position), `count` (timed, e.g. walking).
- **`side`**: `left` / `right` / `both`. Track that side's landmarks.
- The plan is also included in `/context` (as `workout_plan`) and in the visit-ended webhook.

Try it without a real therapist: on the start screen pick **"Demo: Physical therapy → workout plan"**, run it,
tap End visit, then open `/api/patients/demo-patient/workout-plan` (or the patient_id you linked in with).

## 2c. The PT camera app: ready-made plan + session upload (no changes to its code needed)

```
GET  VISIT_COPILOT_URL/api/patients/p123/pt-plan     -> a plan in the exact DEMO_PLAN shape of js/plan.js
POST VISIT_COPILOT_URL/api/pt/sessions               <- the path pushToServer() in js/store.js already uses
```

**Plan:** the response can go straight into the existing `planExercises(plan)`:

```js
// wherever the app currently uses DEMO_PLAN:
const res = await fetch(`${VISIT_COPILOT_URL}/api/patients/${patientId}/pt-plan`).catch(() => null);
const plan = res?.ok ? await res.json() : DEMO_PLAN;     // 404 = no plan from a visit yet -> keep the default
const exercises = planExercises(plan);
```

```json
{
  "id": "plan-<visit id>", "therapist": "Sarah (PT)", "createdAt": "2026-11-14",
  "exercises": [
    { "id": "knee-extension", "mode": "precise", "side": "left", "reps": 10, "target": 165,
      "instruction": "Straighten the knee slowly. Hold 2 seconds at the top.",
      "sets": 2, "holdMs": 2000, "perDay": 3, "note": "Stop if pain goes above 5/10. Ice 15 minutes after exercising." },
    { "id": "mini-squat", "mode": "simple", "side": "auto", "reps": 8, "target": 120,
      "checks": [{ "id": "therapist-limit", "type": "jointAngle", "joint": ["hip","knee","ankle"], "min": 120,
                   "label": "Don't bend past 60°" }], "sets": 2, "perDay": 2 }
  ],
  "untracked": [ { "name": "Walking with walker", "as_prescribed": "three times a day", "duration_minutes": 10 } ],
  "program": { "precautions": [...], "pain_stop_level": 5, "goals": [...], ... }
}
```

- **Only exercise ids that exist in `js/exercises.js` are included** (shoulder-abduction, overhead-stretch,
  knee-extension, mini-squat), because `planExercise()` throws on unknown ids. Everything else the therapist
  prescribed is in `untracked`. If you add exercises to the library, tell Visit Copilot by setting
  `PT_APP_EXERCISES=shoulder-abduction,overhead-stretch,knee-extension,mini-squat,heel-slide` in its `.env`
  (it already knows how to map heel-slide, straight-leg-raise and sit-to-stand).
- `id`, `mode`, `side`, `reps`, `target`, `instruction` are what `planExercise()` reads today.
- **Extras the current code ignores** (use them if you want): `sets`, `holdMs`, `perDay`, `note`
  (pain rule + aftercare), `checks` (the therapist's limit, in the same format as the library's form
  checks), plus `untracked` and `program` (precautions, pain limit, goals).
- **The therapist's limit is already applied to `target`**: "don't bend past 60°" in a mini squat means a
  knee angle of 120° (180 = straight), so the target becomes 120 instead of the library's 110.

**Sessions:** `POST /api/pt/sessions` accepts either the results JSON from `app.js` (`R.data`) or the
`exportSession()` record from `store.js`. Identify the patient with `?patient_id=p123` or a `patient_id` field.
If neither is there, the plan's `planId` is enough. That means **`pushToServer(VISIT_COPILOT_URL, exported)`
works as written**. Sessions show up in `/api/patients/p123/pt-sessions`, in `/context` (`home_exercise`) and
in the FaceTime agent's `prompt_context` ("Seated knee extension: 8/10 good reps, best 168°, pain 3/10").

**Optional "Start home exercises" button** at the end of a visit: set `PT_APP_URL` in Visit Copilot's `.env`
to wherever the PT app runs (`?patient_id=...` is added). Or set `PT_APP_DIR` to the PT app's folder and
Visit Copilot serves it at `/pt` on the same address (no CORS setup needed).

## 3. Get notified when a visit ends (webhook)

Set this in Visit Copilot's `backend/.env`:
```
MAIN_APP_WEBHOOK_URL=https://your-main-app/api/visit-ended
```
When a visit ends, Visit Copilot sends:
```
POST https://your-main-app/api/visit-ended
{ "event": "visit.ended",
  "visit": { "id": "...", "patient_id": "p123", "summary": {...}, "notes": {...}, "questions": [...], ... },
  "workout_plan": { ... same as /workout-plan, or null if no exercises were prescribed ... } }
```
Use it to set reminders, refresh a dashboard, or have the agent call the patient later.

## 4. Search with Typesense directly

Both parts can use the same Typesense cluster. **Use the Search-only API key in the main app.** Only Visit
Copilot needs the Admin key. Always filter by patient:

```bash
# One search across everything for a patient (multi-search)
curl "https://<TYPESENSE_HOST>/multi_search" -H "X-TYPESENSE-API-KEY: <SEARCH_ONLY_KEY>" -d '{
  "searches": [
    {"collection": "medications",  "q": "blood thinner", "query_by": "name,generic_name,purpose",          "filter_by": "patient_id:=p123"},
    {"collection": "exercises",    "q": "knee",          "query_by": "name,body_part,form_cues",           "filter_by": "patient_id:=p123"},
    {"collection": "care_items",   "q": "*",             "query_by": "text",                               "filter_by": "patient_id:=p123 && status:=open"},
    {"collection": "visit_chunks", "q": "what did the doctor say about my knee",
                                   "query_by": "text_doctor_lang,text_patient_lang,embedding",             "filter_by": "patient_id:=p123",
                                   "exclude_fields": "embedding"}
  ]}'
```

| Collection | What's in it | Good for |
|---|---|---|
| `visit_chunks` | ~30 s pieces of the transcript in both languages (+ meaning embeddings) | "What did Dr. Lee say about…?" / conversational search |
| `visits` | One per visit: summaries + key points | History list |
| `medications` | Name, dose, frequency, plain explanation, `change` (new/changed/stopped), `source` (visit/document) | "What's this pill?" |
| `exercises` | Sets, reps, frequency, `form_cues[]` | Coaching on FaceTime |
| `care_items` | `type`: follow_up, test, referral, warning_sign, instruction, open_question; `status` | Reminders, to-dos |

Synonyms work across collections ("blood thinner" = apixaban = 혈액 희석제; "knee" = 무릎). Add more in
`backend/search_index.py` → `SYNONYMS`, then run `python search_index.py setup`.

Meaning-based search (`embedding`) only works if the cluster has the embedding model enabled (needs ~2 GB RAM).
With `TYPESENSE_EMBED_MODEL=off`, drop `embedding` from `query_by`.
