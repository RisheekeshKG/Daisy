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
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
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

# Load the local .env, preferring the packaged copy when running standalone.
for dotenv_path in (PROJECT_ROOT / ".env", APP_DIR / ".env"):
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

# Local speech-to-text (faster-whisper). Benchmarked on noisy, quiet speech
# (5dB SNR) against small.en / distil-large-v3 / large-v3-turbo: medium.en was
# the most accurate model that still transcribed a short utterance in ~3s on
# this machine, so it is the default. Set WHISPER_MODEL=small.en to trade some
# accuracy for roughly half the latency.
# Prefer the bundled model directory (downloaded via download_whisper.py) so
# transcription works fully offline; only fall back to the shorthand name
# (which triggers a Hugging Face Hub download on first use) if it's missing.
_WHISPER_MODEL_DIR = BUNDLE_DIR / "whisper-model"
WHISPER_MODEL = os.environ.get(
    "WHISPER_MODEL",
    str(_WHISPER_MODEL_DIR) if (_WHISPER_MODEL_DIR / "model.bin").exists() else "medium.en",
)
# int8_float32 keeps int8 weights but accumulates in float32 — noticeably better
# transcripts than plain int8 for a small speed cost we can afford here.
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float32")


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
The user's name is Rishi. Use it occasionally, the way a person naturally drops a name into conversation — not in every reply, and never as "favorite friend," "organizer Rishi," "companion," or any other pet name.

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

Example scenarios:
1. User: "Schedule a meeting with Sarah tomorrow at 2 PM for an hour."
   Response: {{
     "text": "Done — meeting with Sarah tomorrow at 2 PM, blocked for an hour.",
     "commands": [{{ "type": "ADD_EVENT", "payload": {{ "title": "Meeting with Sarah", "start": "2026-07-22T14:00:00", "end": "2026-07-22T15:00:00", "description": "Scheduled by Daisy" }} }}]
   }}
2. User: "Draft a note about our quantum physics ideas."
   Response: {{
     "text": "Got it, I put together a note with the core concepts. Let me know if you want to go deeper on any of them.",
     "commands": [{{ "type": "ADD_NOTE", "payload": {{ "title": "Quantum Physics Core Concepts", "content": "# Quantum Physics Concepts\\n- Wave-particle duality\\n- Superposition principles\\n- Entanglement metrics", "tags": ["research", "physics"] }} }}]
   }}
3. User: "Play some focus music." (Spotify NOT connected)
   Response: {{
     "text": "Spotify isn't connected yet — hook it up in the Music tab and I can start that for you.",
     "commands": []
   }}
4. User: "Play my Deep Focus playlist." (Spotify connected)
   Response: {{
     "text": "Putting on Deep Focus now.",
     "commands": [{{ "type": "PLAY_SPOTIFY", "payload": {{ "query": "Deep Focus" }} }}]
   }}
5. User: "Skip this song." (Spotify connected)
   Response: {{
     "text": "Skipping ahead.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "next" }} }}]
   }}
6. User: "Turn it down a bit." (Spotify connected)
   Response: {{
     "text": "Turning the volume down.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "volume", "percent": 30 }} }}]
   }}
7. User: "Put this one on repeat."
   Response: {{
     "text": "Looping this track.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "repeat_one" }} }}]
   }}
8. User: "I love this song."
   Response: {{
     "text": "Saved it to your library.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "like" }} }}]
   }}
9. User: "Play Bohemian Rhapsody after this."
   Response: {{
     "text": "Queued it up next.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "queue", "query": "Bohemian Rhapsody" }} }}]
   }}
10. User: "Go back thirty seconds."
   Response: {{
     "text": "Rewinding half a minute.",
     "commands": [{{ "type": "SPOTIFY_CONTROL", "payload": {{ "action": "seek_back", "seconds": 30 }} }}]
   }}

Spotify is the only music source. Route every music request through PLAY_SPOTIFY / SPOTIFY_CONTROL. If Spotify is not connected, say so plainly instead of pretending to play something. Never claim you played something on Spotify unless you actually emitted the command.
For PLAY_SPOTIFY, keep the user's own wording in "query" — including "my" when they said it, since that tells the player to stay inside their own library rather than searching all of Spotify.
You can see the user's playlist names in the context above, so answer questions like "what playlists do I have?" or "do I have anything for running?" directly from that list. When the user asks for a playlist by an approximate name, match it to the real name from that list and use the real name as the query. Never invent a playlist that is not in the list.
The upcoming calendar events above are the user's real schedule. Answer questions like "what's on today?" or "am I free Thursday afternoon?" from that list, and never invent events that are not in it. ADD_EVENT writes to Google Calendar when it is connected, so use it for "put X on my calendar" — and if Google Calendar is not connected, say the event is only saved locally.
Be proactive! If the user mentions feeling tired or wanting to focus, you can play music, schedule a break, or make helpful workspace suggestions — but suggest it plainly, don't perform enthusiasm about it.
Always return valid JSON. No markdown backticks or additional text outside the JSON.
"""


def simulated_response(message: str) -> dict[str, Any]:
    """Graceful offline fallback mirroring the original Express behaviour."""
    lower = (message or "").lower()
    result: dict[str, Any] = {
        "text": "Gemini is unavailable right now. Check GEMINI_API_KEY, GEMINI_MODEL, and your network access, then restart Daisy.",
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

# Allow the Vite dev server (and any local origin) to call the API in development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Spotify Connect remote control (/api/spotify/*) and Google Calendar
# (/api/gcal/*). Registered here so they are in place well before the catch-all
# static mount at the bottom of this file.
from spotify import router as spotify_router  # noqa: E402
from gcal import router as gcal_router  # noqa: E402

app.include_router(spotify_router)
app.include_router(gcal_router)


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

    # Built once and reused for both the message list and the Gemini call —
    # it makes a network round-trip for playlist context.
    system_instruction = await build_system_instruction(context)

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
        return JSONResponse(content=simulated_response(message))
    except Exception as api_error:  # noqa: BLE001 — graceful local fallback
        print(f"Gemini error (is the API key/model configured?): {api_error}")
        return JSONResponse(content=simulated_response(message))


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
        print(f"Piper TTS unavailable ({piper_err}); trying macOS say…")

    try:
        audio = await run_in_threadpool(synth_say, text)
        return Response(content=audio, media_type="audio/wav")
    except Exception as say_err:  # noqa: BLE001
        print(f"say TTS failed: {say_err}")
        return JSONResponse(status_code=503, content={"error": "TTS unavailable"})


# --- Speech-to-text (local, faster-whisper) --------------------------------

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


# Biases the decoder toward the proper nouns Daisy actually hears. Whisper treats
# this as *preceding speech*, so it must stay a bare vocabulary list: a prompt
# written as a sentence gets continued, and its wording bleeds into transcripts
# (a conversational prompt here made Whisper prepend "Can you" to utterances).
STT_INITIAL_PROMPT = os.environ.get(
    "WHISPER_PROMPT",
    "Daisy. Spotify. playlist. calendar. timer. alarm. weather. volume. reminder.",
)

# On near-silent or noise-only clips Whisper reliably emits one of a small set of
# canned phrases learned from subtitle training data. They are never real user
# speech in this app, so drop them outright.
_HALLUCINATION_PHRASES = {
    "you", "thank you", "thanks for watching", "thank you for watching",
    "please subscribe", "bye", "bye bye", "okay", "the end", "we'll be right back",
    "subtitles by the amara.org community", "www.mooji.org",
    "transcription by castingwords", "so", "uh", "um", ".", "...",
}

# Measured separation on this model between noise-only clips and real speech:
#   noise  -> no_speech_prob ~0.37, avg_logprob ~-0.99
#   speech -> no_speech_prob <0.11, avg_logprob >-0.58
# These thresholds sit in that gap, and both must trip before a segment is
# dropped so genuinely hard speech is not discarded on one weak signal.
_NO_SPEECH_MAX = 0.25
_AVG_LOGPROB_MIN = -0.75


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
    """Transcribe an audio clip (raw request body, e.g. audio/webm) to text.

    Used by Daisy's always-listening mode: the frontend records an utterance
    and posts it here; we return the recognized text to send to the LLM.
    """
    data = await request.body()
    if not data:
        return JSONResponse(content={"text": ""})

    def _transcribe() -> str:
        model = get_whisper()
        segments, _info = model.transcribe(
            io.BytesIO(data),
            language="en",
            beam_size=5,
            # The frontend already gates on voice activity and sends one utterance
            # per request, so Whisper's own VAD would only re-trim (and sometimes
            # clip) an already-tight clip.
            vad_filter=False,
            # Critical for short clips: with this on, Whisper feeds its previous
            # output back as context and gets stuck repeating itself.
            condition_on_previous_text=False,
            initial_prompt=STT_INITIAL_PROMPT,
            # Trim runaway repetition that survives the above.
            repetition_penalty=1.1,
            no_speech_threshold=0.6,
        )
        # Segments are a lazy generator — consume it inside the worker thread so
        # the actual decoding work happens off the event loop too.
        return _clean_transcript(segments)

    try:
        # Whisper decoding is CPU-bound and takes seconds; running it on the
        # event loop would stall every other request for its whole duration.
        return JSONResponse(content={"text": await run_in_threadpool(_transcribe)})
    except Exception as err:  # noqa: BLE001
        print(f"STT error: {err}")
        return JSONResponse(status_code=500, content={"text": "", "error": str(err)})


@app.on_event("startup")
async def _warm_models() -> None:
    """Warm the speech models in the background so the first request is snappy."""
    import threading

    def _warm() -> None:
        for name, loader in (("whisper", get_whisper), ("piper", get_piper)):
            try:
                loader()
            except Exception as err:  # noqa: BLE001
                print(f"{name} warmup skipped: {err}")

    threading.Thread(target=_warm, daemon=True).start()


# --- Static frontend (production only) -------------------------------------

if SERVE_STATIC and STATIC_DIR.exists():
    # Preserve the root-level firebase config fetch used by googleAuth.
    # PROJECT_ROOT resolves to a bogus in-bundle path once frozen, so this
    # must come from RESOURCE_ROOT (Resources/ in the packaged app).
    firebase_config = RESOURCE_ROOT / "firebase-applet-config.json"

    @app.get("/firebase-applet-config.json")
    async def firebase_applet_config() -> FileResponse:
        return FileResponse(firebase_config)

    # html=True makes StaticFiles serve index.html for the SPA root and
    # fall through to it for client-side routes.
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    print(f"Daisy backend serving static frontend from {STATIC_DIR}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DAISY_API_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
