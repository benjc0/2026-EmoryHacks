# Mend

**Understand the visit. Heal at home.**
Live site: mending.fit

Mend helps people who struggle with language or memory get through a doctor's visit and then recover at home. It was built in 48 hours at **EmoryHacks 2026** (November 13–15).

## What it does

**During the visit: Visit Copilot** (during-visit/)
- Live two-way interpreter, such as an English-speaking doctor and a Korean-speaking patient, with large captions in each person's language.
- Turns the conversation into notes and reminds the patient about questions they haven't asked yet.
- At the end, the patient gets a plain-language summary and the doctor's exercises become their home plan.
- Visits are searchable in English and Korean (Typesense).

**After the visit: Mend** (after-visit/)
- Dashboard with today's exercises, next visit, medicine and questions.
- Exercise sessions: the camera counts your reps with pose tracking and tells you how each one went.
- **Mend, an AI coach** (after-visit/coach-agent/): talks you through the exercises by voice, on a FaceTime call or in the browser, counts reps live and shows your results afterwards.

Mend is an AI guide, not a replacement for a therapist or doctor.

## How it fits together

| Part | Tech |
|---|---|
| during-visit/backend | Python, FastAPI, Gemini Live (translation and notes), Typesense (search) |
| during-visit/frontend | Plain HTML/JS |
| after-visit | Plain JS (no build step), MediaPipe pose tracking, on-device storage (IndexedDB) |
| after-visit/coach-agent | Node.js, LiveKit Agents, Gemini Live voice, Chert (FaceTime), MediaPipe in Python |
| design-system/ | Design tokens and rules used by the app |
| deploy/vultr/ | Setup for hosting the Visit Copilot server |

The dashboard is hosted on Vercel (mending.fit). The Visit Copilot runs on its own server (visit.mending.fit).

## Run it locally

You need **Node 22+** and **Python 3**. You also need your own API keys. Keys go in env files that are never committed (.env, .env.local).

**1. Visit Copilot and the dashboard**

cd during-visit/backend
pip install -r requirements.txt
cp .env.example .env          # then add your GEMINI_API_KEY (Typesense is optional)
python -m uvicorn main:app --port 8000

Open http://localhost:8000/ for the Visit Copilot and http://localhost:8000/pt/ for the dashboard.

**2. The AI coach** (optional)

cd after-visit/coach-agent
npm install
cp .env.example .env.local    # LiveKit, Google (Gemini) and Chert values
npm run coach                 # the coach
npm run call-server           # in a second terminal: lets the dashboard reach it

Then open http://127.0.0.1:8787/coach-test.html to talk to Mend in the browser. See [after-visit/coach-agent/README.md](after-visit/coach-agent/README.md) for the FaceTime and "Call my iPhone" setup. Rep counting needs the Python pose helper described there.

## Tests

cd after-visit
npm test

## Notes

Never commit API keys. Create your own from each provider's website (Google AI Studio for Gemini, LiveKit, Chert, Typesense).
Design rules live in design-system/ai-clinic-assistant/MASTER.md.
Engineering audit notes: ENGINEERING_AUDIT.md. How we used Coder: CODER_USAGE.md.

## Team

Benjamin Cofield, Levi Hoffer, Michael Nguyen and michaeltn42.

Built with Gemini, Chert, Typesense and Coder at EmoryHacks 2026.
