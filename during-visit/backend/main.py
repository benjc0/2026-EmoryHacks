"""Visit Copilot backend.

    uvicorn main:app --host 0.0.0.0 --port 8000

Serves the iPhone web app from ../frontend, relays mic audio to Gemini Live Translate,
keeps running notes, reminds the patient about unasked questions, and writes the
finished visit to Typesense.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
import extract
import integration
import search_index
import storage
from demo_script import pick_demo, SCENARIOS
from live import LiveInterpreter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")

app = FastAPI(title="Visit Copilot")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(integration.router)
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


# ---------------------------------------------------------------- visit state

class Visit:
    def __init__(self, req: "StartVisit"):
        self.id = uuid.uuid4().hex[:12]
        self.patient_id = req.patient_id
        self.provider = req.provider
        self.specialty = req.specialty
        self.doctor_lang = req.doctor_lang
        self.patient_lang = req.patient_lang
        self.started_at = time.time()
        self.questions = [{"id": f"q{i + 1}", "text": t.strip(), "text_doctor_lang": None,
                           "status": "open", "evidence": None}
                          for i, t in enumerate(req.questions) if t.strip()]
        self.utterances: list[dict] = []
        self.notes: dict = extract.VisitNotes().model_dump(mode="json")
        self.doc_items = {"medications": [], "care_items": []}   # from scanned papers
        self.summary: dict | None = None
        self.sockets: set[WebSocket] = set()
        self.interp: LiveInterpreter | None = None
        self.dirty = False
        self.reminded: set[str] = set()
        self.ended = False
        self.tasks: list[asyncio.Task] = []
        self.draft_task: asyncio.Task | None = None   # summary drafted while the doctor wraps up
        self.draft_at = -1                            # how many utterances the draft covered
        self.finish_task: asyncio.Task | None = None
        self.summary_failed = False

    # -- outgoing events go to every connected screen (e.g. a family member's phone too)
    async def emit(self, event: dict):
        dead = []
        for ws in self.sockets:
            try:
                await ws.send_text(json.dumps(event, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.discard(ws)

    async def add_utterance(self, utt: dict):
        self.utterances.append({k: utt[k] for k in ["id", "speaker", "original", "translated", "t"]})
        self.dirty = True

    def merged_notes(self) -> dict:
        n = dict(self.notes)
        n["medications"] = self.notes.get("medications", []) + self.doc_items["medications"]
        n["care_items"] = self.notes.get("care_items", []) + self.doc_items["care_items"]
        return n

    def public(self) -> dict:
        return {"id": self.id, "patient_id": self.patient_id, "provider": self.provider,
                "specialty": self.specialty, "doctor_lang": self.doctor_lang,
                "patient_lang": self.patient_lang, "started_at": self.started_at,
                "questions": self.questions, "notes": self.merged_notes(),
                "utterances": self.utterances, "summary": self.summary,
                "summary_pending": bool(self.finish_task and not self.finish_task.done()),
                "pt_app_url": config.PT_APP_URL,
                "summary_failed": self.summary_failed}

    def record(self) -> dict:
        """Everything worth keeping about the visit (what gets saved and indexed)."""
        return {**self.public(), "notes": self.merged_notes(), "ended": self.ended,
                "saved_at": time.time()}

    async def save(self):
        """Write the JSON backup without blocking the server."""
        try:
            await asyncio.to_thread(storage.save_visit, self.record())
        except Exception as e:
            log.warning("backup save failed: %s", e)

    async def push_notes(self):
        await self.emit({"type": "notes", "notes": self.merged_notes(), "questions": self.questions})

    # -- periodic extraction + reminders
    async def run_extraction(self):
        self.dirty = False
        try:
            out = await extract.extract_notes(self.utterances, self.questions,
                                              self.doctor_lang, self.patient_lang)
        except Exception as e:
            log.warning("extraction failed: %s", e)
            await self.emit({"type": "status", "level": "warn", "text": "Notes update failed, retrying soon"})
            self.dirty = True
            return
        data = out.model_dump(mode="json")
        statuses = {q["id"]: q for q in data.pop("questions", [])}
        rank = {"open": 0, "asked": 1, "answered": 2}
        for q in self.questions:   # never downgrade (a manual "I asked it" tap wins)
            s = statuses.get(q["id"])
            if s and rank[s["status"]] > rank[q["status"]]:
                q["status"], q["evidence"] = s["status"], s.get("evidence")
        self.notes = data
        await self.push_notes()
        await self.save()
        if data.get("wrapping_up"):
            await self.remind_open_questions(reason="wrapping_up")
            self.start_draft_summary()

    def start_draft_summary(self):
        """Write the summary in the background so "End visit" is near-instant."""
        if self.ended or (self.draft_task and not self.draft_task.done()):
            return
        self.draft_at = len(self.utterances)
        self.draft_task = asyncio.create_task(extract.summarize(
            list(self.utterances), self.merged_notes(), self.doctor_lang, self.patient_lang))

    async def remind_open_questions(self, reason: str):
        pending = [q for q in self.questions if q["status"] == "open" and q["id"] not in self.reminded]
        if pending:
            self.reminded.update(q["id"] for q in pending)
            await self.emit({"type": "reminder", "reason": reason, "questions": pending})

    async def extraction_loop(self):
        while not self.ended:
            await asyncio.sleep(config.EXTRACT_EVERY_SEC)
            if self.dirty:
                await self.run_extraction()

    async def start_live(self):
        if self.interp:
            return
        self.interp = LiveInterpreter(self.doctor_lang, self.patient_lang,
                                      emit=self.emit, on_final=self.add_utterance)
        await self.interp.start()

    async def run_demo(self, scenario: str | None = None):
        try:
            await self._run_demo(scenario)
        except Exception as e:   # never hang silently on "Listening..."
            log.exception("demo failed")
            await self.emit({"type": "status", "level": "warn",
                             "text": f"Demo failed: {e}. Check that all backend files are the latest version."})

    async def _run_demo(self, scenario: str | None = None):
        t0 = time.time()
        script, _ = pick_demo(self.patient_lang, scenario)
        for delay, speaker, original, translated in script:
            await asyncio.sleep(delay)
            utt = {"id": uuid.uuid4().hex[:10], "speaker": speaker, "original": original,
                   "translated": translated, "t": time.time() - t0,
                   "source_lang": self.doctor_lang if speaker == "doctor" else self.patient_lang,
                   "target_lang": self.patient_lang if speaker == "doctor" else self.doctor_lang}
            await self.emit({"type": "caption", "final": True, **utt})
            await self.add_utterance(utt)
        await self.run_extraction()   # don't wait for the timer at the end of the script


VISITS: dict[str, Visit] = {}


def get_visit(vid: str) -> Visit:
    v = VISITS.get(vid)
    if not v:
        raise HTTPException(404, "visit not found")
    return v


# ---------------------------------------------------------------- REST

class StartVisit(BaseModel):
    patient_id: str = "demo-patient"
    provider: str = ""
    specialty: str = ""
    doctor_lang: str = "en"
    patient_lang: str = "ko"
    questions: list[str] = []


@app.post("/api/visits")
async def start_visit(req: StartVisit):
    v = Visit(req)
    VISITS[v.id] = v
    if v.doctor_lang == v.patient_lang:
        v.tasks.append(asyncio.create_task(v.extraction_loop()))
        return v.public()
    try:
        tr = await extract.translate_questions(
            [{"id": q["id"], "text": q["text"]} for q in v.questions], v.doctor_lang)
        for q in v.questions:
            q["text_doctor_lang"] = tr.get(q["id"])
    except Exception as e:
        log.warning("question translation failed: %s", e)
    v.tasks.append(asyncio.create_task(v.extraction_loop()))
    return v.public()


@app.get("/api/demo-questions")
async def demo_questions(lang: str = "ko", scenario: str | None = None):
    return {"questions": pick_demo(lang, scenario)[1]}


@app.get("/api/demo-scenarios")
async def demo_scenarios():
    return {k: {"doctor_lang": d, "patient_lang": p} for k, (_, _, d, p) in SCENARIOS.items()}


@app.get("/api/visits/{vid}")
async def visit_detail(vid: str):
    if vid not in VISITS:
        saved = storage.load_visit(vid)
        if saved:
            return saved
    return get_visit(vid).public()


@app.post("/api/visits/{vid}/scan")
async def scan(vid: str, file: UploadFile = File(...)):
    v = get_visit(vid)
    limit = 15 * 1024 * 1024
    chunks, total = [], 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:          # stop reading as soon as we're over, instead of buffering it all first
            raise HTTPException(413, "image too large")
        chunks.append(chunk)
    data = b"".join(chunks)
    res = await extract.scan_document(data, file.content_type or "image/jpeg",
                                      v.doctor_lang, v.patient_lang)
    out = res.model_dump(mode="json")
    for m in out["medications"]:
        v.doc_items["medications"].append({**m, "source": "document"})
    for c in out["care_items"]:
        v.doc_items["care_items"].append({**c, "source": "document"})
    await v.push_notes()
    return out


class NewQuestion(BaseModel):
    text: str


@app.post("/api/visits/{vid}/questions")
async def add_question(vid: str, req: NewQuestion):
    v = get_visit(vid)
    q = {"id": f"q{len(v.questions) + 1}", "text": req.text.strip(), "text_doctor_lang": None,
         "status": "open", "evidence": None}
    v.questions.append(q)
    try:
        if v.doctor_lang != v.patient_lang:
            q["text_doctor_lang"] = (await extract.translate_questions(
            [{"id": q["id"], "text": q["text"]}], v.doctor_lang)).get(q["id"])
    except Exception as e:
        log.warning("question translation failed: %s", e)
    await v.push_notes()
    return q


@app.post("/api/visits/{vid}/questions/{qid}")
async def mark_question(vid: str, qid: str, status: str = "asked"):
    v = get_visit(vid)
    for q in v.questions:
        if q["id"] == qid and status in ("open", "asked", "answered"):
            q["status"] = status
    await v.push_notes()
    return {"ok": True}


@app.post("/api/visits/{vid}/end")
async def end_visit(vid: str):
    v = get_visit(vid)
    if v.interp:
        await v.interp.stop()
    v.ended = True
    for t in v.tasks:
        t.cancel()
    v.finish_task = asyncio.create_task(_finish_visit(v))
    try:
        await asyncio.wait_for(asyncio.shield(v.finish_task), timeout=config.SUMMARY_WAIT_SEC)
    except asyncio.TimeoutError:
        log.info("summary still running after %ss; page will poll for it", config.SUMMARY_WAIT_SEC)
    await v.emit({"type": "ended"})
    return {**v.public(), "summary_pending": not v.finish_task.done(),
            "saving": bool(config.TYPESENSE_URL), "pt_app_url": config.PT_APP_URL}


async def _finish_visit(v: "Visit"):
    """Final notes + summary, then save to Typesense."""
    if v.utterances:
        draft_ok = v.draft_task is not None and v.draft_at == len(v.utterances)
        if draft_ok:
            # Nothing new since the draft: use it (usually already finished).
            results = await asyncio.gather(v.draft_task, return_exceptions=True)
            if v.dirty:
                await v.run_extraction()
        else:
            # Final notes + summary at the same time instead of one after the other.
            results = await asyncio.gather(
                v.run_extraction(),
                extract.summarize(v.utterances, v.merged_notes(), v.doctor_lang, v.patient_lang),
                return_exceptions=True)
            results = results[1:]
        if isinstance(results[0], BaseException):
            log.warning("summary failed: %s", results[0])
            v.summary_failed = True
        else:
            v.summary = results[0].model_dump(mode="json")
    await v.save()                      # backup first, so nothing is lost if Typesense fails
    try:
        await asyncio.to_thread(integration.sync_questions_after_visit, v.record())
    except Exception as e:
        log.warning("question sync failed: %s", e)
    await integration.notify_main_app(v.record())
    if config.TYPESENSE_URL:
        await _index_in_background(v)


async def _index_in_background(v: Visit):
    try:
        counts = await search_index.index_visit(v.record())
        log.info("indexed visit %s: %s", v.id, counts)
    except Exception as e:
        log.warning("typesense indexing failed: %s", e)


# ---------------------------------------------------------------- WebSocket

@app.websocket("/ws/visits/{vid}")
async def visit_socket(ws: WebSocket, vid: str):
    v = VISITS.get(vid)
    await ws.accept()
    if not v:
        await ws.close(code=4404)
        return
    v.sockets.add(ws)
    await ws.send_text(json.dumps({"type": "hello", "visit": v.public()}, ensure_ascii=False))
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes"):                 # 16 kHz mono PCM16 from the phone mic
                if v.interp:
                    v.interp.push_audio(msg["bytes"])
                continue
            try:
                data = json.loads(msg.get("text") or "{}")
                if not isinstance(data, dict):
                    raise ValueError("text message must be a JSON object")
            except (json.JSONDecodeError, ValueError) as e:
                log.warning("visit %s: dropping malformed ws message: %s", vid, e)
                continue
            kind = data.get("type")
            if kind == "start_audio":
                await v.start_live()
                await v.emit({"type": "status", "level": "ok", "text": "Interpreter listening"})
            elif kind == "demo":
                v.tasks.append(asyncio.create_task(v.run_demo(data.get("scenario"))))
            elif kind == "remind_now":
                v.reminded.clear()
                await v.remind_open_questions(reason="manual")
    except WebSocketDisconnect:
        pass
    finally:
        v.sockets.discard(ws)


# ---------------------------------------------------------------- frontend

# Optional: serve the PT camera app at /pt (set PT_APP_DIR in .env), so it can fetch plans without CORS setup.
if config.PT_APP_DIR and Path(config.PT_APP_DIR).is_dir():
    app.mount("/pt", StaticFiles(directory=config.PT_APP_DIR, html=True), name="pt")


@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")

app.mount("/", StaticFiles(directory=FRONTEND), name="static")