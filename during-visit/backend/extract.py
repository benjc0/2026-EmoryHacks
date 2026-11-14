"""Gemini text-model calls: note extraction, question tracking, summaries, document scans.

Every call uses structured JSON output (a Pydantic schema), so the frontend and
Typesense always get the same shape of data.
"""
from __future__ import annotations

import asyncio
import json
import logging
from enum import Enum
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

import config
import exercise_library
from config import lang_name

_client: genai.Client | None = None


def client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            api_key=config.GEMINI_API_KEY.strip(),
            http_options=types.HttpOptions(
                api_version="v1beta",
                timeout=int(config.REQUEST_TIMEOUT_SEC * 1000),         # give up on a stuck request
                retry_options=types.HttpRetryOptions(attempts=1),      # no slow built-in retries
            ),
        )
    return _client


# ---------------------------------------------------------------- schemas

class Change(str, Enum):
    new = "new"
    changed = "changed"
    stopped = "stopped"
    continued = "continued"


class Medication(BaseModel):
    name: str = Field(description="Drug name exactly as the doctor said it (brand or generic)")
    generic_name: Optional[str] = None
    dose: Optional[str] = Field(None, description="e.g. '500 mg'. Never round or guess.")
    frequency: Optional[str] = Field(None, description="e.g. 'twice daily with food'")
    purpose: Optional[str] = None
    instructions: Optional[str] = None
    change: Change = Change.new
    explanation_patient_lang: str = Field(description="One or two plain sentences in the patient's language")


class Side(str, Enum):
    left = "left"
    right = "right"
    both = "both"


class Exercise(BaseModel):
    name: str
    exercise_key: Optional[str] = Field(
        None, description="Closest match from the standard exercise list below, or null if none fit")
    body_part: Optional[str] = None
    side: Optional[Side] = None
    sets: Optional[str] = None
    reps: Optional[str] = None
    sets_count: Optional[int] = Field(None, description="Sets as a plain number, e.g. 3 (null if not stated)")
    reps_count: Optional[int] = Field(None, description="Reps as a plain number, e.g. 10 (null if not stated)")
    hold_seconds: Optional[int] = Field(None, description="How long to hold each rep, in seconds, if stated")
    rest_seconds: Optional[int] = Field(None, description="Rest between sets, in seconds, if stated")
    times_per_day: Optional[int] = None
    days_per_week: Optional[int] = None
    duration_minutes: Optional[int] = Field(None, description="For timed exercises like walking, if stated")
    equipment: Optional[str] = Field(None, description="e.g. 'resistance band', 'yoga mat', if mentioned")
    limit_deg: Optional[int] = Field(
        None, description="Clinical movement limit in degrees, if the doctor gave one "
                           "(e.g. 'don't bend past 90', 'don't raise past 120')")
    frequency: Optional[str] = None
    form_cues: list[str] = Field(default_factory=list, description="Short coaching cues the clinician gave")
    explanation_patient_lang: str


class CareType(str, Enum):
    follow_up = "follow_up"
    test = "test"
    referral = "referral"
    warning_sign = "warning_sign"
    instruction = "instruction"


class CareItem(BaseModel):
    type: CareType
    text: str = Field(description="In the doctor's language")
    text_patient_lang: str
    due: Optional[str] = Field(None, description="When, if stated, e.g. 'in 2 weeks'")


class Diagnosis(BaseModel):
    name: str
    explanation_patient_lang: str


class QStatus(str, Enum):
    open = "open"
    asked = "asked"
    answered = "answered"


class QuestionStatus(BaseModel):
    id: str
    status: QStatus
    evidence: Optional[str] = Field(None, description="Very short quote/paraphrase showing it was covered")


class Therapy(BaseModel):
    goals: list[str] = Field(default_factory=list, description="What the exercise program is meant to achieve")
    precautions: list[str] = Field(default_factory=list, description="In the doctor's language")
    precautions_patient_lang: list[str] = Field(default_factory=list)
    pain_stop_level: Optional[int] = Field(None, description="Stop exercising if pain goes above this, 0-10")
    after_exercise: Optional[str] = Field(None, description="What to do after exercising, e.g. 'ice 15 minutes'")
    program_weeks: Optional[int] = Field(None, description="How many weeks the program runs, if stated")
    clinic_sessions_per_week: Optional[int] = Field(None, description="In-clinic PT visits per week, if stated")


class VisitNotes(BaseModel):
    diagnoses: list[Diagnosis] = Field(default_factory=list)
    medications: list[Medication] = Field(default_factory=list)
    exercises: list[Exercise] = Field(default_factory=list)
    therapy: Optional[Therapy] = Field(
        None, description="Program-level exercise info; only set if exercises were prescribed")
    care_items: list[CareItem] = Field(default_factory=list)
    questions: list[QuestionStatus] = Field(default_factory=list)
    wrapping_up: bool = Field(False, description="True if the doctor seems to be ending the visit")


class VisitSummary(BaseModel):
    summary_doctor_lang: str
    summary_patient_lang: str = Field(description="Plain language, about a 6th-grade reading level")
    key_points_patient_lang: list[str]


class TranslatedQuestion(BaseModel):
    id: str
    text_doctor_lang: str


class TranslatedQuestions(BaseModel):
    questions: list[TranslatedQuestion]


class ScanResult(BaseModel):
    document_type: str = Field(description="e.g. prescription, discharge instructions, lab order")
    text_original: str
    text_patient_lang: str
    medications: list[Medication] = Field(default_factory=list)
    care_items: list[CareItem] = Field(default_factory=list)


# ---------------------------------------------------------------- helpers

_RETRYABLE = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "404", "NOT_FOUND", "overloaded", "high demand")


def _thinking(model: str) -> types.ThinkingConfig | None:
    """Keep "thinking" short: it's the biggest source of latency for these simple JSON tasks."""
    lvl = config.THINKING.lower()
    if lvl == "default":
        return None
    if model.startswith("gemini-2.5"):          # 2.5 models use a token budget
        return types.ThinkingConfig(thinking_budget=0 if lvl in ("minimal", "low", "off") else 1024)
    return types.ThinkingConfig(thinking_level=lvl.upper())   # Gemini 3+ use levels


async def _json_call(prompt: str | list, schema: type[BaseModel], model: str | None = None) -> BaseModel:
    """Try the main model, then fallbacks if it's overloaded / rate-limited / not available."""
    first = model or config.TEXT_MODEL
    models = [first] + [m for m in config.FALLBACK_MODELS if m != first]
    last_err: Exception | None = None
    for attempt, model in enumerate(models):
        think = _thinking(model)
        try:
            try:
                resp = await asyncio.wait_for(_generate(model, prompt, schema, think),
                                              config.REQUEST_TIMEOUT_SEC + 2)
            except Exception as e:     # model doesn't accept this thinking setting -> use its default
                if think is None or "400" not in str(e) or "think" not in str(e).lower():
                    raise
                resp = await asyncio.wait_for(_generate(model, prompt, schema, None),
                                              config.REQUEST_TIMEOUT_SEC + 2)
            if resp.parsed is not None:
                return resp.parsed
            return schema.model_validate(json.loads(resp.text))
        except Exception as e:
            last_err = e
            timed_out = isinstance(e, (asyncio.TimeoutError, TimeoutError)) or "timeout" in type(e).__name__.lower()
            if not timed_out and not any(s in str(e) for s in _RETRYABLE):
                raise                      # auth errors, bad requests: don't hide them
            logging.getLogger("extract").warning("%s unavailable (%s), trying next model",
                                                 model, "timed out" if timed_out else str(e)[:80])
    raise last_err


async def _generate(model, prompt, schema, think):
    return await client().aio.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.2,
            thinking_config=think,
        ),
    )


def _transcript_text(utterances: list[dict]) -> str:
    lines = []
    for u in utterances:
        t = int(u.get("t", 0))
        lines.append(f"[{t // 60:02d}:{t % 60:02d}] {u['speaker'].upper()}: {u['original']}"
                     + (f"  (translation: {u['translated']})" if u.get("translated") else ""))
    return "\n".join(lines)


# ---------------------------------------------------------------- calls

EXTRACT_PROMPT = """You are a careful medical scribe helping a PATIENT (not the doctor) remember their visit.
Doctor's language: {doc_lang}. Patient's language: {pat_lang}.

Read the visit transcript so far and return the COMPLETE current notes (not just changes).
Rules:
- Only include what was actually said. Never invent doses, drug names, or dates.
- Copy medication names, doses and numbers exactly as spoken.
- "explanation_patient_lang" / "text_patient_lang" fields must be in {pat_lang}, plain and kind.
- For each patient question below, decide its status:
  open = not covered yet; asked = patient raised it; answered = the doctor covered it (even unprompted).
- wrapping_up = true if the doctor is clearly ending (e.g. "any other questions?", "see you in...").
- For each exercise, also set exercise_key to the closest match from this standard list (or null if none fit
  well -- never force a bad match):
{exercise_keys}
  Fill sets_count/reps_count/hold_seconds/rest_seconds/times_per_day/days_per_week/duration_minutes/equipment/
  limit_deg/side whenever the doctor actually stated them; leave each null rather than guessing.
- If exercises were prescribed, also fill "therapy" with any program-level goals, precautions, pain_stop_level,
  after_exercise care, program_weeks and clinic_sessions_per_week the doctor mentioned. Leave fields null/empty
  if not stated, and leave the whole "therapy" object null if no exercises were prescribed.

Patient's prepared questions (id: text):
{questions}

Transcript:
{transcript}
"""


async def extract_notes(utterances, questions, doc_lang, pat_lang) -> VisitNotes:
    q = "\n".join(f"{x['id']}: {x['text']}" for x in questions) or "(none)"
    prompt = EXTRACT_PROMPT.format(
        doc_lang=lang_name(doc_lang), pat_lang=lang_name(pat_lang),
        questions=q, transcript=_transcript_text(utterances) or "(nothing yet)",
        exercise_keys=exercise_library.prompt_list(),
    )
    return await _json_call(prompt, VisitNotes)


SUMMARY_PROMPT = """Write an after-visit summary for the patient.
Doctor's language: {doc_lang}. Patient's language: {pat_lang}.
- summary_doctor_lang: 4-6 sentences in {doc_lang} (so the doctor/family can check it).
- summary_patient_lang: the same content in {pat_lang}, plain words, about a 6th-grade reading level.
- key_points_patient_lang: 3-6 short bullet points in {pat_lang}: what's wrong, what to take, what to do, when to come back, when to get help.
Keep drug names and numbers exact. End summary_patient_lang with a reminder to confirm anything unclear with the care team.

Extracted notes (JSON):
{notes}

Transcript:
{transcript}
"""


async def summarize(utterances, notes: dict, doc_lang, pat_lang) -> VisitSummary:
    prompt = SUMMARY_PROMPT.format(
        doc_lang=lang_name(doc_lang), pat_lang=lang_name(pat_lang),
        notes=json.dumps(notes, ensure_ascii=False), transcript=_transcript_text(utterances),
    )
    return await _json_call(prompt, VisitSummary, model=config.SUMMARY_MODEL)


async def translate_questions(questions, doc_lang) -> dict[str, str]:
    """Translate the patient's questions into the doctor's language so the patient can
    just show the phone to the doctor."""
    if not questions:
        return {}
    prompt = (f"Translate each patient question into {lang_name(doc_lang)} as the patient would say it "
              f"to their doctor. Keep ids.\n" + json.dumps(questions, ensure_ascii=False))
    out: TranslatedQuestions = await _json_call(prompt, TranslatedQuestions)
    return {q.id: q.text_doctor_lang for q in out.questions}


SCAN_PROMPT = """This is a photo of a paper the patient got at a medical visit.
Read ALL the text (text_original), translate it into {pat_lang} (text_patient_lang),
and pull out any medications and care items (follow-ups, tests, warning signs, instructions).
Doctor's language: {doc_lang}. Copy drug names, doses and numbers exactly. If something is unreadable, say so rather than guessing."""


async def scan_document(image: bytes, mime: str, doc_lang, pat_lang) -> ScanResult:
    parts = [
        types.Part.from_bytes(data=image, mime_type=mime),
        SCAN_PROMPT.format(doc_lang=lang_name(doc_lang), pat_lang=lang_name(pat_lang)),
    ]
    return await _json_call(parts, ScanResult)