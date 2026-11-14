# How We Used Coder — Demo Talking Points

A quick-reference for presenting the "we used Coder" angle for Mend
(EmoryHacks 2026). Everything below reflects what actually happened in this
project — no exaggeration needed, the real workflow is the pitch.

---

## 30-second pitch (say this out loud)

> "Mend is three different tech stacks glued together — a client-only JS
> app, a Node LiveKit/Gemini voice agent, and a Python FastAPI backend. We
> used Coder to spin up one cloud dev environment straight from our GitHub
> URL, no local setup at all, and ran a full AI-agent-driven engineering
> audit inside it — safely, on an isolated branch, without ever touching
> our own laptops. It found a real security leak, fixed a broken feature,
> and took our test suite from 68 to 71 passing tests, all verifiable
> inside that one workspace."

---

## Quick facts

| | |
|---|---|
| Workspace created from | a single git repo URL — no manual environment config |
| Tech stacks in one workspace | 3 (client JS / Node ESM / Python FastAPI) |
| Lines of code reviewed | ~6,000 |
| Test suite before → after | 68 → **71 passing** |
| Security issue found | a live-looking API key committed to git history |
| Real functional bug found & fixed | a therapist's exercise plan was being silently ignored |
| Risk to local machine | zero — all work happened inside the disposable workspace |

---

## Talking points (pick whichever fit your demo flow)

### 1. Zero-to-dev-environment in one step
We didn't install Node, Python, or any dependencies by hand. We created a
Coder workspace from a template and gave it one parameter — our GitHub repo
URL — and it cloned and set everything up automatically. That's the kind of
friction a hackathon team doesn't have time for, and Coder removed it.

### 2. One workspace, three stacks, zero conflicts
Mend isn't one app — it's a JS pose-tracking frontend, a Node/LiveKit voice
agent, and a Python FastAPI backend, each with their own runtime and
dependencies. All three ran, built, and tested inside a single Coder
workspace side by side, without any "wrong Python version" or "wrong Node
version" headaches.

### 3. We let an AI agent actually work inside the workspace
We ran a full engineering audit — reading the whole codebase, finding bugs,
fixing them, running the test suites — with an AI agent operating directly
inside the Coder workspace's shell and filesystem. It wasn't just chatting
about the code, it was editing files, running `npm test`, running Python
compiles, and verifying its own fixes, live, in a real environment.

### 4. Totally sandboxed — our real machines were never at risk
Everything happened on a disposable cloud workspace, on an isolated git
branch (`engineering-audit-fixes`), separate from `main`. If anything had
gone wrong, we'd have just thrown the workspace away — nothing touched our
laptops, and nothing touched our working demo branch until we explicitly
decided to merge it.

### 5. Disposable, throwaway tooling for one-off checks
At one point we needed to verify a Python dependency upgrade wouldn't break
anything. We spun up a temporary virtual environment *inside* the
workspace, used it to confirm the fix, and discarded it — no residue, no
cleanup needed on anything that matters.

### 6. Concrete, verifiable results — not just vibes
This wasn't just "AI looked at the code." Inside the workspace we could
prove:
- Test count went from 68 to 71 passing (and we can show the actual
  `npm test` output).
- We caught a real security issue — a live-looking API key committed to
  git history — *before* it became a demo-day problem.
- We found and fixed a genuine functional bug where a therapist's actual
  exercise plan wasn't making it into the patient's session.

### 7. Reproducible for the whole team
Anyone on the team (or a judge) can spin up the exact same workspace from
the same template and repo URL and land in the identical environment we
audited — no "works on my machine."

---

## If asked "what exactly does Coder do here?"

Coder hosts the actual development environment in the cloud — the
workspace where code is edited, run, and tested — rather than requiring
everyone to configure that environment locally. For this project that
meant: one-command environment setup from a repo URL, a safe isolated place
to let an AI agent make real code changes and run real tests, and an
environment any teammate (or judge) could reproduce identically.
