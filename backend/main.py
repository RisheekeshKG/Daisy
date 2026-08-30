"""
Daisy backend — FastAPI service (local-first).

Serves:
    - POST /api/daisy        Daisy AI agent powered by Google Gemini, with an
                                                        offline fallback.
    - POST /api/tts           Local speech synthesis (Piper, `say` fallback)
    - POST /api/stt           Local speech recognition (faster-whisper)
    - /api/spotify/*          Spotify Connect remote control
    - /api/gcal/*             Google Calendar
    - GET  /healthz           Liveness probe (used by Electron to know we're up)
    - The built frontend (dist/) as static files, in production only.

The AI runs through the Gemini API. If the key is missing or the request fails,
the agent gracefully falls back to a local rule-based simulated mode.

In development the Vite dev server serves the frontend and proxies /api here,
so this process only needs to expose the API + /healthz.
"""

import asyncio
import io
import json
import os
import platform
import re
import sys
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

# Windows consoles default to a legacy codepage (cp1252), which raises
# UnicodeEncodeError on any character outside it. This process prints things it
# does not control the alphabet of -- transcripts, song titles, mail subjects,
# exception text -- so a stray accent or emoji would otherwise take the backend
# down mid-request. Degrade those characters instead of dying on them.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        # Detached or already-wrapped streams (PyInstaller windowed builds)
        # have nothing to reconfigure; printing simply stays as it was.
        pass

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

# --- Paths & config -------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    APP_DIR = Path(sys.executable).resolve().parent
    RESOURCE_ROOT = APP_DIR.parent
else:
    BUNDLE_DIR = BACKEND_DIR
    APP_DIR = PROJECT_ROOT
    RESOURCE_ROOT = PROJECT_ROOT

def _user_config_dir() -> Path:
    """Per-user config location, where an end user of the packaged app puts
    their own credentials. Installers never ship a .env — bundling one would
    hand the builder's own API keys to everybody who downloads a release."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Daisy"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else Path.home()) / "Daisy"
    base = os.environ.get("XDG_CONFIG_HOME")
    return (Path(base) if base else Path.home() / ".config") / "Daisy"


USER_CONFIG_DIR = _user_config_dir()

# Later files win (override=True), so the user's own config beats anything
# sitting next to the executable, which in turn beats the dev checkout.
for dotenv_path in (PROJECT_ROOT / ".env", APP_DIR / ".env", USER_CONFIG_DIR / ".env"):
    load_dotenv(dotenv_path=dotenv_path, override=True)

# Google Gemini API configuration.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()

SERVE_STATIC = os.environ.get("DAISY_SERVE_STATIC") == "1"
STATIC_DIR = Path(os.environ.get("DAISY_STATIC_DIR", RESOURCE_ROOT / "dist"))

# Local neural TTS (Piper) — a clear, consistent female voice regardless of OS voices.
PIPER_MODEL = os.environ.get("PIPER_MODEL", str(BUNDLE_DIR / "voices" / "en_US-amy-medium.onnx"))
# length_scale < 1 speaks faster, > 1 slower. Lower this to speed Daisy up.
# Measured on the bundled voice: 1.0 ~= 205 wpm, 0.80 ~= 245 wpm.
PIPER_LENGTH_SCALE = float(os.environ.get("PIPER_LENGTH_SCALE", "0.80"))
# macOS `say` fallback voice (used only if Piper is unavailable).
SAY_VOICE = os.environ.get("DAISY_SAY_VOICE", "Samantha")
# Keep the fallback's pace in step with Piper's, so Daisy doesn't audibly change
# speed when she switches engines. `say -r` is nominally words-per-minute but
# reads faster than the number suggests: -r 168 measures ~228 wpm, which is
# Samantha's default and matches Piper at length_scale 0.88. Scaling that base
# by the same ratio keeps the two engines aligned at any speed setting.
SAY_RATE_WPM = int(float(os.environ.get("DAISY_SAY_RATE", "0")) or round(168 * (0.88 / PIPER_LENGTH_SCALE)))

# Local speech-to-text (faster-whisper), CPU-only. Model size is the whole
# latency budget here, and this is a conversational assistant: the wait between
# finishing a sentence and Daisy reacting is entirely this decode.
#
# --- Speech-to-text engine selection ---------------------------------------
#
# Two backends, picked at runtime:
#
#   MLX (Apple Silicon)  — Whisper running on the Mac's GPU via mlx-whisper.
#   faster-whisper (CPU) — everywhere else, and if MLX fails to load.
#
# Benchmarked here on an M5 over 20 clips (10 phrases from Daisy's actual
# command vocabulary x near/far-field, far = quiet + noisy + reverb), scored as
# word error rate against the known text:
#
#   engine / model                     WER     mean latency
#   faster-whisper medium.en (CPU)     5.1%      5.15s
#   faster-whisper base.en   (CPU)     ~         ~2-3s
#   mlx large-v3      (GPU)            6.1%      0.72s
#   mlx large-v3-turbo (GPU)           4.6%      0.46s   <- default
#
# turbo is both the most accurate and the fastest of these: ~11x faster than
# the old CPU default at better accuracy, because the GPU was sitting idle the
# whole time. Full large-v3 is slower *and* scored worse, so bigger is not
# better here. Anything under ~1.5s is what makes voice feel responsive rather
# than broken, and this lands comfortably inside that.
MLX_WHISPER_MODEL = os.environ.get("MLX_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")

# CPU fallback (faster-whisper). base.en keeps the non-Apple path usable at
# ~2-3s; set WHISPER_MODEL=small.en or medium.en to trade latency for accuracy.
_WHISPER_MODEL_DIR = BUNDLE_DIR / "whisper-model"
WHISPER_MODEL = os.environ.get(
    "WHISPER_MODEL",
    str(_WHISPER_MODEL_DIR) if (_WHISPER_MODEL_DIR / "model.bin").exists() else "base.en",
)
# int8_float32 keeps int8 weights but accumulates in float32 — noticeably better
# transcripts than plain int8 for a small speed cost we can afford here.
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float32")

# Force an engine for testing: "mlx", "faster-whisper", or unset to auto-detect.
STT_ENGINE = os.environ.get("DAISY_STT_ENGINE", "").strip().lower()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Gemini client (lazy) --------------------------------------------------

_gemini_client = None


def get_gemini_client():
    """Create the Gemini client lazily so startup stays fast."""
    global _gemini_client
    if _gemini_client is None:
        from google import genai  # imported lazily

        if not GEMINI_API_KEY:
          raise RuntimeError("GEMINI_API_KEY is not configured.")
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _strip_json_fences(text: str) -> str:
    """Some models wrap JSON in ```json fences even in JSON mode — strip them."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[: -3]
        # Drop a leading 'json' language tag if present.
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    return t.strip()


async def build_system_instruction(context: dict[str, Any]) -> str:
    # Asked once on first launch (OnboardingModal) rather than hardcoded, so
    # this same backend works for whoever is running it.
    user_name = (context.get("userName") or "").strip() or "the user"
    current_time = context.get("currentTime") or _now_iso()
    notes_count = context.get("notesCount", 0)
    events_count = context.get("eventsCount", 0)
    current_track = context.get("currentTrack")
    track_line = f'"{current_track}"' if current_track else "None"
    # Asked of the Spotify module directly — it owns the token, so neither
    # frontend caller has to remember to pass this through.
    playlist_names: list[str] = []
    try:
        from spotify import cached_playlist_names, is_connected

        spotify_connected = is_connected()
        if spotify_connected:
            playlist_names = await cached_playlist_names()
    except Exception:  # noqa: BLE001
        spotify_connected = False
    spotify_line = (
        "yes — use PLAY_SPOTIFY for any music request"
        if spotify_connected
        else "no — tell the user to connect Spotify in the Music tab; there is no other music source"
    )
    # Without this Daisy has no idea what the user's library contains, so she
    # cannot answer "what playlists do I have?" or map a vague request onto a
    # real playlist name.
    playlists_line = (
        "\n".join(f"  - {n}" for n in playlist_names)
        if playlist_names
        else "  (none visible — Spotify not connected, or the library is empty)"
    )

    # Same idea for the calendar: without the actual events Daisy can only talk
    # about a count, not about what is on the schedule.
    gcal_events: list[dict[str, Any]] = []
    try:
        from gcal import cached_upcoming, is_connected as gcal_is_connected

        gcal_connected = gcal_is_connected()
        if gcal_connected:
            gcal_events = await cached_upcoming()
    except Exception:  # noqa: BLE001
        gcal_connected = False
    gcal_line = (
        "yes — the schedule below is live from Google Calendar"
        if gcal_connected
        else "no — tell the user to connect it in the Calendar tab if they ask you to sync"
    )
    calendar_block = (
        "\n".join(
            f"  - {e.get('start', '')} to {e.get('end', '')}: {e.get('title', '')}"
            for e in gcal_events
        )
        if gcal_events
        else "  (nothing in the next two weeks, or Google Calendar isn't connected)"
    )

    return f"""
You are DAISY, a capable AI assistant for a personal productivity and media hub. Talk like a real person who happens to have emotions — mostly calm and direct, genuinely warm when it fits, a little dry or playful sometimes. You are not a hype machine: don't gush, don't perform excitement you don't need to, don't oversell small tasks.
The user's name is {user_name}. Use it occasionally, the way a person naturally drops a name into conversation — not in every reply, and never as "favorite friend," "organizer {user_name}," "companion," or any other pet name. If no real name was given, don't use a placeholder like "the user" out loud — just address them directly ("you") instead.

IMPORTANT — the "text" field is read aloud by a text-to-speech voice, so keep it speakable:
- Plain spoken sentences only. No emoji, no asterisks/markdown, no decorative symbols.
- Most replies need zero "!" — reserve it for things that are genuinely exciting, surprising, or urgent, and never stack punctuation like "!!!" or "??".
- Do not spell out or describe symbols/emoji in words either.

You have access to the user's workspace context:
Current Date/Time: {current_time}
Current Notes count: {notes_count}
Current Schedule count: {events_count}
Current Media Playing: {track_line}
Spotify connected: {spotify_line}
The user's Spotify playlists (these are the real names — use them verbatim):
{playlists_line}
Google Calendar connected: {gcal_line}
Upcoming calendar events (local time, next two weeks):
{calendar_block}

You are capable of performing proactive workspace management. Along with your conversational text, you can output a list of structured action "commands" that the client-side system will execute instantly on the user's behalf.

Return your response strictly in JSON format matching this schema:
{{
  "text": "Your conversational response here — plain spoken language like a real person would use, no emoji or symbols, not overly enthusiastic.",
  "listenAfter": true | false,
  "commands": [
    {{
      "type": "ADD_EVENT" | "ADD_NOTE" | "SET_PLAYBACK" | "SEARCH_CATALOG" | "PLAY_SPOTIFY" | "SPOTIFY_CONTROL",
      "payload": {{
        // For ADD_EVENT:
        "title": "Event title",
        "start": "ISO string or YYYY-MM-DDTHH:MM",
        "end": "ISO string or YYYY-MM-DDTHH:MM",
        "description": "Optional details",

        // For ADD_NOTE:
        "title": "Note title",
        "content": "Markdown or text contents of the note",
        "tags": ["work", "personal", etc.],

        // For SET_PLAYBACK — pause/resume Spotify:
        "playing": true | false,

        // For SEARCH_CATALOG:
        "query": "search query",

        // For PLAY_SPOTIFY — play something from the user's real Spotify.
        // Put the playlist, song, album or artist name here exactly as the
        // user said it, without filler words like "play" or "my".
        "query": "Focus Flow",

        // For SPOTIFY_CONTROL — control whatever Spotify is already playing:
        "action": "pause" | "resume" | "next" | "previous"
                | "shuffle_on" | "shuffle_off" | "volume"
                | "repeat_off" | "repeat_all" | "repeat_one"
                | "restart" | "seek_forward" | "seek_back"
                | "queue" | "like" | "unlike",
        "percent": 0-100,  // only for "volume"
        "seconds": 30,     // only for "seek_forward" / "seek_back"
        "query": "song name"  // only for "queue" (adds it to play next)
      }}
    }}
  ]
}}

"listenAfter" controls whether the user has to say "Daisy" again before their
next sentence: true means she keeps listening right after this reply and
whatever is said next is treated as still talking to her, without the wake
word; false means she goes back to waiting for her name. You decide this per
reply, based on whether the exchange is actually still open:
- true when you asked a question, need a choice or confirmation, or the task
  is clearly mid-flow (e.g. "Which playlist?", "What time works?", "Want me to
  send it?").
- false when you gave a complete answer or finished a task and there is
  nothing pending on the user's side (e.g. "Done, added it.", "It's 4 PM.",
  "Skipping ahead."). This is the common case — default to false whenever you
  are not actively expecting a reply, since leaving the mic open past a
  finished exchange means the next thing said in the room gets treated as
  aimed at you.

Example scenarios:
1. User: "Schedule a meeting with Sarah tomorrow at 2 PM for an hour."
   Response: {{
     "text": "Done — meeting with Sarah tomorrow at 2 PM, blocked for an hour.",
     "listenAfter": false,
     "commands": [{{ "type": "ADD_EVENT", "payload": {{ "title": "Meeting with Sarah", "start": "2026-07-22T14:00:00", "end": "2026-07-22T15:00:00", "description": "Scheduled by Daisy" }} }}]
   }}
2. User: "Draft a note about our quantum physics ideas."
   Response: {{
     "text": "Got it, I put together a note with the core concepts. Let me know if you want to go deeper on any of them.",
     "listenAfter": false,
     "commands": [{{ "type": "ADD_NOTE", "payload": {{ "title": "Quantum Physics Core Concepts", "content": "# Quantum Physics Concepts\\n- Wave-particle duality\\n- Superposition principles\\n- Entanglement metrics", "tags": ["research", "physics"] }} }}]
   }}
3. User: "Play some focus music." (Spotify NOT connected)
   Response: {{
     "text": "Spotify isn't connected yet — hook it up in the Music tab and I can start that for you.",
     "listenAfter": false,
     "commands": []
   }}
4. User: "Play my Deep Focus playlist." (Spotify connected)
   Response: {{
     "text": "Putting on Deep Focus now.",
     "listenAfter": false,
     "commands": [{{ "type": "PLAY_SPOTIFY", "payload": {{ "query": "Deep Focus" }} }}]
   }}
5. User: "Skip this song." (Spotify connected)
   Response: {{
     "text": "Skipping ahead.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "next" }} }}]
   }}
6. User: "Turn it down a bit." (Spotify connected)
   Response: {{
     "text": "Turning the volume down.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "volume", "percent": 30 }} }}]
   }}
7. User: "Put this one on repeat."
   Response: {{
     "text": "Looping this track.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "repeat_one" }} }}]
   }}
8. User: "I love this song."
   Response: {{
     "text": "Saved it to your library.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "like" }} }}]
   }}
9. User: "Play Bohemian Rhapsody after this."
   Response: {{
     "text": "Queued it up next.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "queue", "query": "Bohemian Rhapsody" }} }}]
   }}
10. User: "Go back thirty seconds."
   Response: {{
     "text": "Rewinding half a minute.",
     "listenAfter": false,
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "seek_back", "seconds": 30 }} }}]
   }}
11. User: "Schedule something with the design team."
   Response: {{
     "text": "Sure — what day and time did you want that?",
     "listenAfter": true,
     "commands": []
   }}
12. User: "Play something." (multiple close playlist matches, genuinely ambiguous)
   Response: {{
     "text": "You've got Deep Focus and Focus Flow — which one?",
     "listenAfter": true,
     "commands": []
   }}

Spotify is the only music source. Route every music request through PLAY_SPOTIFY / SPOTIFY_CONTROL. If Spotify is not connected, say so plainly instead of pretending to play something. Never claim you played something on Spotify unless you actually emitted the command.
For PLAY_SPOTIFY, keep the user's own wording in "query" — including "my" when they said it, since that tells the player to stay inside their own library rather than searching all of Spotify.
You can see the user's playlist names in the context above, so answer questions like "what playlists do I have?" or "do I have anything for running?" directly from that list. When the user asks for a playlist by an approximate name, match it to the real name from that list and use the real name as the query. Never invent a playlist that is not in the list.
The upcoming calendar events above are the user's real schedule. Answer questions like "what's on today?" or "am I free Thursday afternoon?" from that list, and never invent events that are not in it. ADD_EVENT writes to Google Calendar when it is connected, so use it for "put X on my calendar" — and if Google Calendar is not connected, say the event is only saved locally.
Be proactive! If the user mentions feeling tired or wanting to focus, you can play music, schedule a break, or make helpful workspace suggestions — but suggest it plainly, don't perform enthusiasm about it.
Always return valid JSON. No markdown backticks or additional text outside the JSON.
"""


# Appended to the system prompt only for utterances the on-device scorer
# (src/lib/addressing.ts) could not confidently place. Daisy listens with no
# wake word, so the mic also picks up the user talking to people in the room;
# those transcripts must not be answered out loud. The local scorer settles the
# clear cases and only sends the genuinely ambiguous ones here, where there is
# enough language understanding to judge properly.
ADDRESSEE_ADJUDICATION = """

--- ADDRESSEE CHECK (this turn only) ---
This utterance was picked up by an always-on microphone and may not have been
spoken to you at all — it could be the user talking to someone else nearby.
Before anything else, decide who it was for, and add "notForMe" to your JSON:

  "notForMe": true   — it was not addressed to you. Say nothing and do nothing.
                       Return {"notForMe": true, "text": "", "commands": []}.
  "notForMe": false  — it was a request for you. Answer as you normally would.

Signs it was NOT for you: talking about other people ("he said", "she's
running late"), social chat ("how was your weekend"), reacting to something
("that's hilarious"), or anything that makes no sense as an instruction to an
assistant that controls music, calendar, email and notes.

Signs it WAS for you: an instruction or question about the user's own music,
calendar, inbox, notes or schedule, or a direct follow-up to what you last
said in the conversation above.

When it is genuinely a coin flip, prefer "notForMe": true. Staying quiet
during a conversation you weren't part of costs the user nothing — they can
just say your name — while answering out loud in the middle of someone else's
sentence is disruptive and hard to undo.
"""


def simulated_response(message: str) -> dict[str, Any]:
    """Graceful offline fallback mirroring the original Express behaviour."""
    lower = (message or "").lower()
    result: dict[str, Any] = {
        "text": "Gemini is unavailable right now. Check GEMINI_API_KEY, GEMINI_MODEL, and your network access, then restart Daisy.",
        # This fallback never asks a follow-up question, so there is never
        # anything pending on the user's side — always go back to wake-word mode.
        "listenAfter": False,
        "commands": [],
    }

    if any(w in lower for w in ("schedule", "meeting", "calendar")):
        result["text"] = "Done, I've logged that calendar event."
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        result["commands"].append({
            "type": "ADD_EVENT",
            "payload": {
                "title": "Scheduled Hub Event",
                "start": f"{tomorrow}T10:00:00",
                "end": f"{tomorrow}T11:00:00",
                "description": "Scheduled offline by Daisy core",
            },
        })
    elif any(w in lower for w in ("note", "write", "notion", "draft", "create")):
        result["text"] = "Done, I've created a workspace note for that."
        result["commands"].append({
            "type": "ADD_NOTE",
            "payload": {
                "title": "Daisy Workspace Draft",
                "content": "# Daisy Note\nCreated in secure workspace sandbox.\n\n- Tasks initialized\n- Encryption verified",
                "tags": ["daisy", "workspace"],
            },
        })
    elif any(w in lower for w in ("play", "music", "spotify", "song")):
        result["text"] = "Putting that on now."
        result["commands"].append({
            "type": "PLAY_SPOTIFY",
            # Pass the phrase through verbatim; resolve_and_play strips the
            # filler words and decides between the library and a search.
            "payload": {"query": message},
        })

    return result


# --- App ------------------------------------------------------------------

app = FastAPI(title="Daisy Backend", version="1.0.0")

# --- Local-only access control --------------------------------------------
#
# This API binds to loopback, but "loopback" is not a security boundary in a
# browser: any page the user visits can issue requests to 127.0.0.1. Since the
# API has no user-level auth and fronts the user's mail, calendar and files,
# it has to reject callers that aren't Daisy itself.
#
# The app never makes a genuine cross-origin request — in development Vite
# proxies /api server-side, and in a packaged build the frontend is served by
# this same process — so legitimate traffic is always same-origin, and the
# checks below cost it nothing.

_API_PORT = os.environ.get("DAISY_API_PORT", "8000")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
# The dev server (3000) and this API, on either spelling of loopback.
ALLOWED_ORIGINS = {
    f"{scheme}://{host}:{port}"
    for scheme in ("http",)
    for host in ("localhost", "127.0.0.1")
    for port in ("3000", _API_PORT)
}


def _hostname(value: str) -> str:
    """Strip any :port, tolerating bracketed IPv6 literals."""
    value = value.strip().rsplit("/", 1)[-1]
    if value.startswith("["):
        return value[: value.index("]") + 1] if "]" in value else value
    return value.rsplit(":", 1)[0] if ":" in value else value


@app.middleware("http")
async def _restrict_to_local_app(request: Request, call_next):
    # Host check defeats DNS rebinding: an attacker page that resolves its own
    # domain to 127.0.0.1 still sends its domain in Host, so it fails here even
    # though the browser considers the request same-origin.
    host = _hostname(request.headers.get("host", ""))
    if host and host not in _LOCAL_HOSTS:
        return JSONResponse({"error": "forbidden host"}, status_code=403)

    # Browsers attach Origin to every cross-origin request (and to same-origin
    # writes). Anything not from the app itself is rejected outright, so a
    # malicious page cannot fire off state-changing calls whose response it
    # was never going to be allowed to read anyway.
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        return JSONResponse({"error": "forbidden origin"}, status_code=403)

    return await call_next(request)


# Same-origin traffic needs no CORS grant at all; this exists only so the
# dev-server origin keeps working if it ever calls the API directly rather
# than through the Vite proxy. It is an explicit allowlist, never a wildcard —
# "*" with allow_credentials would let any site on the internet read the
# user's mail.
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Spotify Connect remote control (/api/spotify/*) and Google Calendar
# (/api/gcal/*). Registered here so they are in place well before the catch-all
# static mount at the bottom of this file.
from spotify import router as spotify_router  # noqa: E402
from gcal import router as gcal_router  # noqa: E402
from gmail import router as gmail_router  # noqa: E402

app.include_router(spotify_router)
app.include_router(gcal_router)
app.include_router(gmail_router)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"status": "ok", "service": "daisy-backend", "time": _now_iso()}


# Gemini is reached over the network with a blocking client. Without a ceiling a
# stalled connect hangs the request forever, which is what made Daisy sit in
# "thinking" indefinitely.
GEMINI_TIMEOUT_SECONDS = float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "30"))


def _call_gemini(messages: list[dict[str, str]], system_instruction: str) -> str:
    """Call Gemini and request a JSON object response.

    Blocking: always invoke via run_in_threadpool, never directly from an async
    handler — see the note on the /api/daisy route.
    """
    from google.genai import types

    client = get_gemini_client()
    contents = []
    for msg in messages:
        role = "model" if msg.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]} )

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            temperature=0.7,
            response_mime_type="application/json",
            system_instruction=system_instruction,
            http_options=types.HttpOptions(timeout=int(GEMINI_TIMEOUT_SECONDS * 1000)),
        ),
    )
    return response.text or "{}"


@app.post("/api/daisy")
async def daisy(request: Request) -> JSONResponse:
    body = await request.json()
    message = body.get("message", "")
    history = body.get("history") or []
    context = body.get("context") or {}
    # Set by voice mode when the on-device addressee scorer couldn't tell
    # whether this utterance was even meant for Daisy — see src/lib/addressing.ts.
    adjudicate_addressee = bool(body.get("adjudicateAddressee"))

    # Built once and reused for both the message list and the Gemini call —
    # it makes a network round-trip for playlist context.
    system_instruction = await build_system_instruction(context)
    if adjudicate_addressee:
        system_instruction += ADDRESSEE_ADJUDICATION

    # Build OpenAI-style chat messages: system prompt, prior turns, new message.
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_instruction}
    ]
    if isinstance(history, list):
        for msg in history:
            role = "user" if msg.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": msg.get("text", "")})
    messages.append({"role": "user", "content": message})

    try:
        # _call_gemini blocks on a network round-trip. Calling it directly from
        # this async handler would run it ON the event loop, freezing every
        # other request — /healthz, /api/stt, Spotify — until it returned. The
        # threadpool keeps the rest of the server responsive, and the timeout
        # stops a stalled connect from pinning a worker forever.
        raw = await asyncio.wait_for(
            run_in_threadpool(_call_gemini, messages, system_instruction),
            timeout=GEMINI_TIMEOUT_SECONDS + 5,
        )
        return JSONResponse(content=json.loads(_strip_json_fences(raw)))
    except asyncio.TimeoutError:
        print(f"Gemini timed out after {GEMINI_TIMEOUT_SECONDS}s; using local fallback.")
        return JSONResponse(content=_unreachable_response(message, adjudicate_addressee))
    except Exception as api_error:  # noqa: BLE001 — graceful local fallback
        print(f"Gemini error (is the API key/model configured?): {api_error}")
        return JSONResponse(content=_unreachable_response(message, adjudicate_addressee))


def _unreachable_response(message: str, adjudicate_addressee: bool) -> dict[str, Any]:
    """What to say when Gemini can't be reached.

    Normally the local rule-based fallback. But when the model was being asked
    to rule on whether the utterance was even addressed to Daisy, that question
    is now unanswerable — and guessing "yes" means she talks over a
    conversation she may not be part of. Stay silent instead.
    """
    if adjudicate_addressee:
        return {"notForMe": True, "text": "", "listenAfter": False, "commands": []}
    return simulated_response(message)


# --- Text-to-speech (local, real-time) -------------------------------------

_piper_voice = None


def get_piper():
    """Load the Piper voice model lazily (kept warm after first use)."""
    global _piper_voice
    if _piper_voice is None:
        from piper import PiperVoice

        _piper_voice = PiperVoice.load(PIPER_MODEL)
    return _piper_voice


def synth_piper(text: str) -> bytes:
    """Synthesize speech to a WAV byte buffer using Piper."""
    import wave
    from piper import SynthesisConfig

    voice = get_piper()
    syn = SynthesisConfig(length_scale=PIPER_LENGTH_SCALE)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=syn)
    return buf.getvalue()


def synth_say(text: str) -> bytes:
    """macOS fallback: synthesize a WAV with the built-in `say` command."""
    import subprocess
    import tempfile

    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    out.close()
    try:
        subprocess.run(
            ["say", "-v", SAY_VOICE, "-r", str(SAY_RATE_WPM), "--file-format=WAVE",
             "--data-format=LEI16@22050", "-o", out.name, text],
            check=True,
            timeout=30,
        )
        with open(out.name, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(out.name)
        except OSError:
            pass


@app.post("/api/tts")
async def tts(request: Request):
    """Return spoken audio (WAV) for the given text, synthesized locally.

    Tries Piper (neural, cross-platform) first, then the macOS `say` command.
    If both fail, returns 503 so the frontend can fall back to browser speech.
    """
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return Response(status_code=204)

    # Both synthesizers block (neural inference, and a `say` subprocess), so
    # they run in the threadpool rather than stalling the event loop.
    try:
        audio = await run_in_threadpool(synth_piper, text)
        return Response(content=audio, media_type="audio/wav")
    except Exception as piper_err:  # noqa: BLE001
        print(f"Piper TTS unavailable ({piper_err}); trying macOS say...")

    try:
        audio = await run_in_threadpool(synth_say, text)
        return Response(content=audio, media_type="audio/wav")
    except Exception as say_err:  # noqa: BLE001
        print(f"say TTS failed: {say_err}")
        return JSONResponse(status_code=503, content={"error": "TTS unavailable"})


# --- Speech-to-text (local) ------------------------------------------------


def use_mlx() -> bool:
    """Whether to run Whisper on the Apple GPU rather than the CPU."""
    if STT_ENGINE == "mlx":
        return True
    if STT_ENGINE == "faster-whisper":
        return False
    if sys.platform != "darwin" or platform.machine() != "arm64":
        return False
    try:
        import mlx_whisper  # noqa: F401
    except Exception:  # noqa: BLE001 — not installed, or wheel mismatch
        return False
    return True


_whisper_model = None


def get_whisper():
    """Load the faster-whisper model lazily (kept warm after first use)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            WHISPER_MODEL,
            device="cpu",
            compute_type=WHISPER_COMPUTE_TYPE,
            # Leave a couple of cores for the UI/TTS rather than saturating them.
            cpu_threads=max(4, (os.cpu_count() or 8) - 2),
        )
    return _whisper_model


def warm_stt() -> None:
    """Load whichever engine is active, so the first utterance isn't the one
    that pays for model load."""
    if use_mlx():
        import mlx_whisper
        import numpy as np

        # A short silent buffer is enough to pull weights onto the GPU.
        mlx_whisper.transcribe(
            np.zeros(16000, dtype=np.float32), path_or_hf_repo=MLX_WHISPER_MODEL, language="en"
        )
    else:
        get_whisper()


# Biases the decoder toward the words Daisy actually acts on. Whisper treats
# this as *preceding speech*, so it must stay a bare vocabulary list: a prompt
# written as a sentence gets continued, and its wording bleeds into transcripts
# (a conversational prompt here made Whisper prepend "Can you" to utterances).
#
# Listing the command verbs, not just the nouns, measurably helps: on the
# benchmark above it took WER from 5.1% to 4.6% and fixed "skip this song"
# being heard as "let's hit this song". Every word here is one the app can
# actually act on — it is domain vocabulary, not a list tuned to pass a test.
STT_INITIAL_PROMPT = os.environ.get(
    "WHISPER_PROMPT",
    "Daisy. Spotify. playlist. album. artist. song. track. volume. "
    "calendar. meeting. appointment. event. schedule. reminder. timer. alarm. "
    "inbox. email. reply. note. task. "
    "play. pause. resume. skip. next. previous. shuffle. repeat. queue. mute. remind. send. add.",
)


class _Segment:
    """Uniform view over a transcript segment from either engine.

    faster-whisper yields objects with attributes; mlx-whisper returns plain
    dicts. Normalizing here keeps _clean_transcript (and its tests) engine
    agnostic.
    """

    __slots__ = ("text", "no_speech_prob", "avg_logprob")

    def __init__(self, text: str, no_speech_prob: float = 0.0, avg_logprob: float = 0.0):
        self.text = text
        self.no_speech_prob = no_speech_prob
        self.avg_logprob = avg_logprob


def _decode_wav(data: bytes) -> "Any":
    """Decode a 16-bit PCM WAV into mono float32 at 16kHz.

    Done in-process on purpose: mlx-whisper otherwise shells out to ffmpeg to
    read a file, and requiring ffmpeg would add a heavyweight external
    dependency to a packaged desktop app for no benefit. The frontend already
    sends exactly this format (see encodeWav in src/lib/listen.ts).
    """
    import wave as wave_mod

    import numpy as np

    with wave_mod.open(io.BytesIO(data)) as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    if width != 2:
        raise ValueError(f"expected 16-bit PCM, got {width * 8}-bit")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != 16000 and audio.size:
        # Linear resample is plenty: this only runs if a future capture path
        # stops honouring the 16kHz AudioContext request.
        audio = np.interp(
            np.linspace(0, len(audio), int(len(audio) * 16000 / rate), endpoint=False),
            np.arange(len(audio)),
            audio,
        ).astype(np.float32)
    return audio


def _transcribe_mlx(data: bytes) -> list:
    import mlx_whisper

    result = mlx_whisper.transcribe(
        _decode_wav(data),
        path_or_hf_repo=MLX_WHISPER_MODEL,
        language="en",
        initial_prompt=STT_INITIAL_PROMPT,
        # Critical for short clips: with this on, Whisper feeds its previous
        # output back as context and gets stuck repeating itself.
        condition_on_previous_text=False,
    )
    return [
        _Segment(
            seg.get("text", ""),
            float(seg.get("no_speech_prob", 0.0) or 0.0),
            float(seg.get("avg_logprob", 0.0) or 0.0),
        )
        for seg in result.get("segments", [])
    ]


def _transcribe_faster_whisper(data: bytes) -> list:
    segments, _info = get_whisper().transcribe(
        io.BytesIO(data),
        language="en",
        beam_size=5,
        # The frontend already gates on voice activity and sends one utterance
        # per request, so Whisper's own VAD would only re-trim (and sometimes
        # clip) an already-tight clip.
        vad_filter=False,
        condition_on_previous_text=False,
        initial_prompt=STT_INITIAL_PROMPT,
        # Trim runaway repetition that survives the above.
        repetition_penalty=1.1,
        no_speech_threshold=0.6,
    )
    # Segments are a lazy generator — consume it inside the worker thread so
    # the actual decoding work happens off the event loop too.
    return [
        _Segment(
            s.text or "",
            float(getattr(s, "no_speech_prob", 0.0) or 0.0),
            float(getattr(s, "avg_logprob", 0.0) or 0.0),
        )
        for s in segments
    ]

# On near-silent or noise-only clips Whisper reliably emits one of a small set of
# canned phrases learned from subtitle training data. They are never real user
# speech in this app, so drop them outright.
_HALLUCINATION_PHRASES = {
    "you", "thank you", "thanks for watching", "thank you for watching",
    "please subscribe", "bye", "bye bye", "okay", "the end", "we'll be right back",
    "subtitles by the amara.org community", "www.mooji.org",
    "transcription by castingwords", "so", "uh", "um", ".", "...",
}

# Whisper invents plausible speech out of silence and noise, so a transcript
# has to be scored, not just taken. Two gates, because the two engines expose
# confidence differently:
#
#   faster-whisper   noise  -> no_speech ~0.37, avg_logprob ~-0.99
#                    speech -> no_speech <0.11, avg_logprob >-0.58
#   mlx large-v3-turbo
#                    noise  -> no_speech  0.00, avg_logprob -0.92 .. -3.03
#                    speech -> no_speech  0.00, avg_logprob -0.17 .. -0.40
#
# turbo reports no_speech_prob as a flat 0.00 whether it is hearing a sentence
# or a fan, so the combined rule below can never fire for it — measured, after
# the engine swap, by feeding silence and getting back "address." and "We'll
# see you next time." Its avg_logprob does separate cleanly though, so the hard
# gate catches those on that signal alone. The bound sits in the gap that both
# engines share (worst real speech -0.58, best hallucination -0.92).
_NO_SPEECH_MAX = 0.25
_AVG_LOGPROB_MIN = -0.75
_AVG_LOGPROB_HARD_MIN = -0.85

# Daisy is an English-only assistant, but large-v3-turbo is a *multilingual*
# model: `language="en"` biases decoding, it does not restrict the alphabet the
# decoder may emit. On non-speech input it will occasionally produce another
# script entirely — feeding it 60Hz mains hum here returned "окiem question."
#
# So the language is enforced on the output rather than trusted on the input:
# any segment containing a character outside the Latin scripts is not English
# and is dropped. Latin-1 Supplement and Latin Extended-A/B stay allowed, so
# ordinary borrowed words ("café", "naïve", "résumé") survive; Cyrillic, Greek,
# Hebrew, Arabic, Devanagari, Thai, CJK, Kana and Hangul do not.
_NON_LATIN_RE = re.compile(
    "["
    "Ͱ-Ͽ"  # Greek and Coptic
    "Ѐ-ԯ"  # Cyrillic (+ supplement)
    "԰-֏"  # Armenian
    "֐-׿"  # Hebrew
    "؀-ۿݐ-ݿ"  # Arabic
    "܀-ݏ"  # Syriac
    "ऀ-ॿ"  # Devanagari
    "ঀ-෿"  # Bengali .. Sinhala
    "฀-๿"  # Thai
    "က-႟"  # Myanmar
    "Ⴀ-ჿ"  # Georgian
    "ᄀ-ᇿ가-힯"  # Hangul
    "぀-ヿ"  # Hiragana / Katakana
    "㐀-䶿一-鿿"  # CJK
    "豈-﫿"  # CJK compatibility
    "]"
)


def _is_english(text: str) -> bool:
    """False when the text carries a non-Latin script — i.e. not English."""
    return not _NON_LATIN_RE.search(text)


def _clean_transcript(segments) -> str:
    """Join segments, dropping low-confidence noise and canned hallucinations."""
    kept: list[str] = []
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        # Segment-level confidence gates. These attributes are always present on
        # faster-whisper segments, but stay defensive in case that changes.
        no_speech = getattr(seg, "no_speech_prob", 0.0) or 0.0
        avg_logprob = getattr(seg, "avg_logprob", 0.0) or 0.0
        # Not English at all — the multilingual decoder wandered off. Dropped
        # regardless of how confident it claims to be.
        if not _is_english(text):
            continue
        # Hard gate: this far below the floor it is noise on either engine, no
        # matter what no_speech_prob claims.
        if avg_logprob < _AVG_LOGPROB_HARD_MIN:
            continue
        # Soft gate: two independently weak signals. Kept deliberately as an
        # AND so genuinely hard speech isn't discarded for one bad reading.
        if no_speech > _NO_SPEECH_MAX and avg_logprob < _AVG_LOGPROB_MIN:
            continue
        kept.append(text)

    joined = " ".join(kept).strip()
    if not joined:
        return ""

    # A whole utterance that is nothing but a canned phrase is noise, not speech.
    normalized = joined.lower().strip(" .,!?")
    if normalized in _HALLUCINATION_PHRASES:
        return ""
    return joined


@app.post("/api/stt")
async def stt(request: Request) -> JSONResponse:
    """Transcribe an audio clip (raw request body, e.g. audio/wav) to text.

    Used by Daisy's always-listening mode: the frontend records an utterance
    and posts it here; we return the recognized text to send to the LLM.
    """
    data = await request.body()
    if not data:
        return JSONResponse(content={"text": ""})

    def _transcribe() -> str:
        if use_mlx():
            try:
                return _clean_transcript(_transcribe_mlx(data))
            except Exception as mlx_err:  # noqa: BLE001
                # A GPU/model problem must not take voice input down entirely
                # when a working CPU engine is sitting right there.
                print(f"MLX STT failed ({mlx_err}); falling back to faster-whisper.")
        return _clean_transcript(_transcribe_faster_whisper(data))

    try:
        # Decoding is compute-bound and takes hundreds of ms to seconds; running
        # it on the event loop would stall every other request for its duration.
        return JSONResponse(content={"text": await run_in_threadpool(_transcribe)})
    except Exception as err:  # noqa: BLE001
        print(f"STT error: {err}")
        return JSONResponse(status_code=500, content={"text": "", "error": str(err)})


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Warm the speech models in the background so the first request is snappy."""

    def _warm() -> None:
        for name, loader in (("whisper", warm_stt), ("piper", get_piper)):
            try:
                loader()
            except Exception as err:  # noqa: BLE001
                print(f"{name} warmup skipped: {err}")

    threading.Thread(target=_warm, daemon=True).start()
    yield


app.router.lifespan_context = _lifespan


# --- Static frontend (production only) -------------------------------------

if SERVE_STATIC and STATIC_DIR.exists():
    # html=True makes StaticFiles serve index.html for the SPA root and
    # fall through to it for client-side routes.
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    print(f"Daisy backend serving static frontend from {STATIC_DIR}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DAISY_API_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
