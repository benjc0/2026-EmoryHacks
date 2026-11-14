# Visit Copilot — live interpreter + notes for the doctor's visit

The in-visit part of the AI Clinic Assistant: a web app you open on an iPhone in the exam room.

- **Live two-way interpreter**: Doctor (English) ⇄ family (Korean, or 11 other languages). Big captions, with doses and numbers highlighted, and optional spoken translation.
- **Running notes**: diagnosis, medicines, exercises, follow-ups and warning signs, explained in the patient's language.
- **Question reminders**: the patient's prepared questions are tracked live. When the doctor starts wrapping up, the app shows the ones that are still unasked. "Show doctor" flips the question into the doctor's language in big text.
- **Scan paper**: photograph a prescription or discharge sheet, and it's read, translated and added to the notes.
- **After-visit summary** in both languages, saved to **Typesense** for the rest of the app (search, FaceTime agent).
- **Accessibility**: captions double as live captions for deaf or hard-of-hearing patients; adjustable text size (long-press "Aa" for high contrast); dark mode; screen-reader labels.

## How it works

```
iPhone Safari ── 16 kHz PCM over WebSocket ──► FastAPI ──► Gemini Live Translate  (lane 1: → patient language)
   captions / notes / reminders ◄────────────     │    └─► Gemini Live Translate  (lane 2: → doctor language)
                                                 ├─► Gemini Flash every 20 s: notes + question status (JSON)
                                                 └─► Typesense on "End visit"
```

Live Translate translates into one target language per session, so we run **two sessions on the same audio**.
With `echo_target_language=False`, each lane stays silent on speech that is already in its target language,
so **whichever lane answers tells us who spoke**. No speaker diarization needed.

## Run it

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # add GEMINI_API_KEY (and Typesense if you have it)
python search_index.py setup   # once, only if Typesense is configured
uvicorn main:app --host 0.0.0.0 --port 8000
```

**The iPhone needs HTTPS for the microphone.** Options:
- Coder workspace: open the forwarded port URL (it's HTTPS) in Safari.
- Anywhere else: `cloudflared tunnel --url http://localhost:8000` (or ngrok) and open the https URL.

Then in Safari: Share → **Add to Home Screen** so it opens full-screen like an app.

**No mic or API quota? Tap "Run demo visit"**: it plays a scripted English/Korean knee-pain visit through the
real UI, note extraction and reminders. Use it to develop, and as the backup for judging.

## Typesense collections (contract with the rest of the team)

| Collection | Key fields |
|---|---|
| `visit_chunks` | ~30 s transcript chunks, `text_doctor_lang`, `text_patient_lang`, auto-embedding → conversational search / RAG |
| `visits` | `summary_doctor_lang`, `summary_patient_lang`, `key_points_patient_lang` |
| `medications` | `name`, `dose`, `frequency`, `explanation_patient_lang`, `change`, `source` (visit/document) |
| `exercises` | `name`, `body_part`, `sets`, `reps`, `form_cues[]` → what the FaceTime agent coaches |
| `care_items` | `type` (follow_up, test, referral, warning_sign, instruction, **open_question**), `due`, `status` |

All collections have `patient_id`, `visit_id`, `provider` and `date`. A shared synonym set (`clinic-synonyms`) links
everyday words, medical terms and Korean, e.g. "blood thinner" = warfarin = 혈액 희석제. Questions that weren't asked
get saved as `open_question` care items, so the at-home side can bring them up.

## Files

- `backend/main.py`: API, WebSocket, visit state, reminders
- `backend/live.py`: two-lane Live Translate interpreter and caption assembly
- `backend/extract.py`: Gemini prompts and JSON schemas (notes, summary, scan, question translation)
- `backend/search_index.py`: Typesense schemas, synonyms, indexing
- `backend/demo_script.py`: scripted demo visit
- `frontend/`: the iPhone web app (plain HTML/JS/CSS, no build step)

## Demo-day checklist

- Keep the phone screen on and face-up (the app requests a wake lock).
- If you use "Speak aloud", use earbuds so the mic doesn't re-translate the translation.
- Rehearse on venue Wi-Fi; keep the demo-visit button as a fallback.
- Mock patients only, no real health data.
-make video
