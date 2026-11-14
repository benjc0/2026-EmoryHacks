"""All settings come from environment variables (or a .env file next to this one)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Dedicated speech-to-speech translation model on the Live API.
LIVE_TRANSLATE_MODEL = os.getenv("LIVE_TRANSLATE_MODEL", "gemini-3.5-live-translate-preview")
# Fast text model for note extraction, summaries, document scans.
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.8-flash")
# Model for the end-of-visit summary (try "gemini-2.5-flash-lite" if you want it even faster).
SUMMARY_MODEL = os.getenv("GEMINI_SUMMARY_MODEL", TEXT_MODEL)
# How much the text models "think" before answering: minimal | low | medium | default.
# Lower = much faster. These are simple JSON tasks, so "low" is plenty.
THINKING = os.getenv("GEMINI_THINKING", "low")
# Max seconds to wait for one Gemini text request before trying the next model.
REQUEST_TIMEOUT_SEC = float(os.getenv("GEMINI_REQUEST_TIMEOUT_SEC", "20"))
# "End visit" shows the notes after at most this many seconds; the summary fills in when ready.
SUMMARY_WAIT_SEC = float(os.getenv("SUMMARY_WAIT_SEC", "8"))
# Tried in order when the main model is overloaded (503), rate-limited (429) or unavailable.
FALLBACK_MODELS = [m.strip() for m in os.getenv(
    "GEMINI_FALLBACK_MODELS", "gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite").split(",") if m.strip()]

# How often (seconds) to re-run note extraction while new speech is arriving.
EXTRACT_EVERY_SEC = float(os.getenv("EXTRACT_EVERY_SEC", "20"))

# Typesense. Leave TYPESENSE_HOST empty to run without it (data stays in memory).
TYPESENSE_HOST = os.getenv("TYPESENSE_HOST", "")          # e.g. xyz.a1.typesense.net
TYPESENSE_PORT = os.getenv("TYPESENSE_PORT", "443")
TYPESENSE_PROTOCOL = os.getenv("TYPESENSE_PROTOCOL", "https")
TYPESENSE_API_KEY = os.getenv("TYPESENSE_API_KEY", "")
# Built-in multilingual model (handles Korean + English). Needs ~1.5 GB RAM on the
# cluster. Set to "off" to skip vector fields entirely.
TYPESENSE_EMBED_MODEL = os.getenv("TYPESENSE_EMBED_MODEL", "ts/paraphrase-multilingual-mpnet-base-v2")

# Where the JSON backup of every visit is written (backend/data by default).
DATA_DIR = os.getenv("DATA_DIR", str(Path(__file__).parent / "data"))

# ---- Hand-off to the main app
# If set, the full visit is POSTed here as JSON when it ends: {"event": "visit.ended", "visit": {...}}
MAIN_APP_WEBHOOK_URL = os.getenv("MAIN_APP_WEBHOOK_URL", "")
# Optional: folder of the PT camera app to serve at /pt on this server (absolute path), and/or the URL the
# visit summary's "Start home exercises" button opens (patient_id is added). Leave both empty to hide the button.
PT_APP_DIR = os.getenv("PT_APP_DIR", "")
PT_APP_URL = os.getenv("PT_APP_URL", "/pt/" if PT_APP_DIR else "")
# Allow DELETE /api/patients/{id} (the dashboard's "Reset demo data"). Defaults off;
# set ALLOW_RESET=true in .env for local/demo use. Turn off for anything real.
ALLOW_RESET = os.getenv("ALLOW_RESET", "false").lower() in ("1", "true", "yes")
# Web origins allowed to call this API from a browser (comma-separated). "*" = anyone (fine for a hackathon).
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

TYPESENSE_URL = f"{TYPESENSE_PROTOCOL}://{TYPESENSE_HOST}:{TYPESENSE_PORT}" if TYPESENSE_HOST else ""

LANG_NAMES = {
    "en": "English", "ko": "Korean", "es": "Spanish", "zh": "Chinese", "vi": "Vietnamese",
    "ar": "Arabic", "fr": "French", "hi": "Hindi", "pt": "Portuguese", "ru": "Russian",
    "ja": "Japanese", "tl": "Tagalog",
}


def lang_name(code: str) -> str:
    return LANG_NAMES.get(code, code)