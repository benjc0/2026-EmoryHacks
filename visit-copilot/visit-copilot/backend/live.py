"""Two-way live interpreter on top of Gemini Live Translate.

The Live Translate model translates into ONE target language per session, so we
open two sessions and feed both the same microphone audio:

    lane "doctor"  : target = patient language  -> translates what the DOCTOR says
    lane "patient" : target = doctor language   -> translates what the PATIENT says

With echo_target_language=False a session stays silent when the speech is already
in its target language, so whichever lane produces a translation tells us who was
speaking. No speaker diarization needed.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
import uuid
from typing import Awaitable, Callable

from google.genai import types

import config
from extract import client

log = logging.getLogger("live")

Emit = Callable[[dict], Awaitable[None]]

DROP_UNTRANSLATED_AFTER = 6.0   # seconds of input with no translation -> other lane's speech
FINALIZE_AFTER_SILENCE = 2.5    # close a caption bubble if nothing new arrives


class Lane:
    def __init__(self, speaker: str, source_lang: str, target_lang: str, interp: "LiveInterpreter"):
        self.speaker = speaker
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.interp = interp
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=200)
        self.pending_input = ""
        self.pending_since = 0.0
        self.cur: dict | None = None
        self.last_activity = 0.0
        self.task: asyncio.Task | None = None

    # ---- caption assembly
    async def on_input(self, text: str, lang: str | None):
        if lang and lang.split("-")[0] == self.target_lang:
            return  # already in our target language -> the other lane owns it
        now = time.monotonic()
        if self.cur:
            self.cur["original"] += text
            self.last_activity = now
            await self.interp.emit_caption(self.cur, final=False)
        else:
            if not self.pending_input:
                self.pending_since = now
            self.pending_input += text

    async def on_output(self, text: str):
        now = time.monotonic()
        if not self.cur:
            self.cur = {
                "id": uuid.uuid4().hex[:10],
                "speaker": self.speaker,
                "source_lang": self.source_lang,
                "target_lang": self.target_lang,
                "original": self.pending_input,
                "translated": "",
                "t": self.interp.elapsed(),
            }
            self.pending_input = ""
        self.cur["translated"] += text
        self.last_activity = now
        await self.interp.emit_caption(self.cur, final=False)

    async def finalize(self):
        if self.cur:
            cur, self.cur = self.cur, None
            cur["original"] = cur["original"].strip()
            cur["translated"] = cur["translated"].strip()
            await self.interp.emit_caption(cur, final=True)
        self.pending_input = ""

    async def tick(self):
        now = time.monotonic()
        if self.cur and now - self.last_activity > FINALIZE_AFTER_SILENCE:
            await self.finalize()
        if not self.cur and self.pending_input and now - self.pending_since > DROP_UNTRANSLATED_AFTER:
            self.pending_input = ""

    # ---- Gemini session
    def live_config(self) -> types.LiveConnectConfig:
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            translation_config=types.TranslationConfig(
                target_language_code=self.target_lang,
                echo_target_language=False,
            ),
        )

    async def run(self):
        """Keep a session open for the whole visit; reconnect if it drops."""
        while not self.interp.closed:
            try:
                async with client().aio.live.connect(
                    model=config.LIVE_TRANSLATE_MODEL, config=self.live_config()
                ) as session:
                    log.info("lane %s connected (-> %s)", self.speaker, self.target_lang)
                    sender = asyncio.create_task(self._send_loop(session))
                    try:
                        await self._recv_loop(session)
                    finally:
                        sender.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # network blip, session time limit, etc.
                log.warning("lane %s error: %s", self.speaker, e)
                await self.interp.emit({"type": "status", "level": "warn",
                                        "text": f"Interpreter reconnecting ({self.speaker})…"})
                await asyncio.sleep(1.0)

    async def _send_loop(self, session):
        while True:
            chunk = await self.queue.get()
            if chunk is None:
                await session.send_realtime_input(audio_stream_end=True)
                return
            await session.send_realtime_input(
                audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000"))

    async def _recv_loop(self, session):
        while not self.interp.closed:
            async for msg in session.receive():
                sc = msg.server_content
                if not sc:
                    continue
                if sc.input_transcription and sc.input_transcription.text:
                    await self.on_input(sc.input_transcription.text, sc.input_transcription.language_code)
                if sc.output_transcription and sc.output_transcription.text:
                    await self.on_output(sc.output_transcription.text)
                if sc.model_turn:
                    for part in sc.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            await self.interp.emit({
                                "type": "audio", "lane": self.speaker, "lang": self.target_lang,
                                "data": base64.b64encode(part.inline_data.data).decode(),
                            })
                if sc.turn_complete or sc.generation_complete:
                    await self.finalize()

    def push_audio(self, chunk: bytes):
        try:
            self.queue.put_nowait(chunk)
        except asyncio.QueueFull:  # fell behind: drop oldest audio rather than lag forever
            try:
                self.queue.get_nowait()
                self.queue.put_nowait(chunk)
            except asyncio.QueueEmpty:
                pass


class LiveInterpreter:
    def __init__(self, doc_lang: str, pat_lang: str, emit: Emit,
                 on_final: Callable[[dict], Awaitable[None]]):
        self.emit = emit
        self.on_final = on_final
        self.closed = False
        self.started = time.monotonic()
        self.lanes = [
            Lane("doctor", doc_lang, pat_lang, self),
            Lane("patient", pat_lang, doc_lang, self),
        ]
        self._ticker: asyncio.Task | None = None

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    async def emit_caption(self, utt: dict, final: bool):
        await self.emit({"type": "caption", "final": final, **utt})
        if final and (utt["original"] or utt["translated"]):
            await self.on_final(utt)

    async def start(self):
        for lane in self.lanes:
            lane.task = asyncio.create_task(lane.run())
        self._ticker = asyncio.create_task(self._tick_loop())

    async def _tick_loop(self):
        while not self.closed:
            await asyncio.sleep(0.5)
            for lane in self.lanes:
                await lane.tick()

    def push_audio(self, chunk: bytes):
        for lane in self.lanes:
            lane.push_audio(chunk)

    async def stop(self):
        self.closed = True
        for lane in self.lanes:
            await lane.finalize()
            if lane.task:
                lane.task.cancel()
        if self._ticker:
            self._ticker.cancel()
