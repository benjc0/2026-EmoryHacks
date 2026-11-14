# Mend FaceTime coach

The second way to do a home PT session. Instead of recording in the browser (`../session.html`), the patient
gets a FaceTime call from an AI coach. The coach talks them through the therapist's plan, watches the camera,
counts and scores every rep out loud, answers questions, asks about pain, and saves the session in the same
format as `session.html`.

```
iPhone FaceTime ──► Chert's Mac ──► LiveKit room ◄── coach (agent.mjs) ──► Gemini Live (voice)
                                                         │
                                                         └─► pose helper (MediaPipe) ──► ../js tracker + scoring
```

It reuses the browser app's plain-JS modules (`../js/plan.js`, `exerciseTracker.js`, `repCounter.js`,
`sessionLog.js`), so reps are scored exactly the same way in both paths.

## What a session sounds like

1. "Hi, I'm Mend, your AI exercise coach. First: side arm raise. Face the camera… 5 reps. Aim for 140 degrees.
   I'll start counting when I can see you."
2. If it can't see the right body parts: "I can't see your head down to your hips yet. Step back a little."
3. Each rep: "2. Good rep." / "3. Raise your arm a little higher." / "One to go!"
4. "Side arm raise done. 4 of 5 good reps. Last one: mini squat…" (simple mode: no degrees)
5. "On a scale of 0 to 10, how much pain did you feel today?" 6 or more gets "Please rest… tell your therapist."
6. The record is saved to `sessions/<id>.json` (not committed). A hang-up still saves what was done.

The patient can talk at any time ("what am I on?", "skip this one", "it hurts", "my pain is 3"). The model
has three tools: `skip_exercise`, `session_status`, `record_pain`.

## Setup

Node 22.23.2+, 24 or 26.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (never commit it):

| Value | Where |
|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project → Settings → API keys (free) |
| `GOOGLE_API_KEY` | https://aistudio.google.com/apikey (free tier) |
| `AGENT_NAME` | a name no other team uses |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID`, `COACH_PATIENT_PHONE` | only for "Call my iPhone": Chert console (Developer page, line page) and the patient's verified iPhone |

Body tracking needs the pose helper once: see [pose/README.md](pose/README.md) (on Windows it runs in WSL Ubuntu).

## Run it

Terminal 1, the coach:

```bash
npm start
```

Then pick one way in:

- **Patient FaceTimes the coach.** Terminal 2, from this folder (Ctrl+C frees the line):
  ```bash
  npx --yes @trychert/facetime@0.1.0-beta.21 dev --agent emory-pt-coach
  ```
  When it says the agent is in a waiting room, FaceTime Video the line.
- **The coach calls the patient ("Call my iPhone"), or a browser test.** Terminal 2:
  ```bash
  npm run call-server
  ```
  Open http://127.0.0.1:8787/coach-test.html. For a phone, put an https tunnel in front of it
  (`cloudflared tunnel --url http://localhost:8787`) and open `<tunnel>/coach-test.html`.
  "Call my iPhone" needs the line free, so stop `chert dev` first (Chert answers `line_busy` otherwise).

## Files

| File | What it does |
|---|---|
| `agent.mjs` | the coach: joins the call, publishes its face, runs Gemini Live, feeds video to the session |
| `coach-session.mjs` | the guided session: plan → positioning → reps → summary → pain → record (no LiveKit; tested) |
| `pose.mjs`, `pose-frames.mjs`, `pose/pose_server.py` | MediaPipe pose on the caller's video: crops FaceTime's black bars, one frame in flight |
| `caller-video.mjs` | reads the caller's FaceTime camera track |
| `caller-audio.mjs` | diagnostics only (`COACH_DIAGNOSTICS=1`): the caller's voice level |
| `call-server.mjs`, `outbound.mjs` | local server for "Call my iPhone" and the browser test; keys stay on this computer |
| `greet.mjs`, `chert-rooms.mjs`, `face.mjs` | from Chert's starter: greet on `bridge_ready`, Chert rooms, the drawn face |
| `AGENTS.md`, `CLAUDE.md` | Chert's rules for coding agents |

Tests live in `../tests` (`coach.test.mjs`, `pose.test.mjs`, `outbound.test.mjs`); run `npm test` in `after-visit`.

## Chert rules that matter

- Greet within 10 s of `bridge_ready`, or the Mac ends the call. The coach starts on that signal, never on join.
- Only the coach publishes audio, and its face comes from the same participant.
- One call at a time per line. `chert dev` holds the line while it runs.
- Restart both terminals after changing the agent: a waiting room can still hold the old code.

## Known issues (Nov 2026)

- **Caller audio is silent on our trial line.** Chert's Mac delivers the caller's `facetime-remote-audio` as
  all zeros, so the coach can't hear the patient over FaceTime (it can still see them, and the browser test hears
  fine). Run with `COACH_DIAGNOSTICS=1` to check; this needs Chert to fix on the line.
- **Chert's relay reconnects every few minutes.** A call placed during a reconnect doesn't reach the coach;
  `chert dev` recovers by itself.
- Trial calls are capped at 5 minutes.
