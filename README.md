<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Daisy

A premium personal hub combining Spotify-style music, Notion-style notes, a
calendar, and the cheerful **Daisy** AI agent. Ships as a desktop app (Electron)
backed by a **FastAPI** Python service. The AI chat agent uses the **Google
Gemini API**.

## Architecture

- **Frontend** — React + Vite (`src/`).
- **Backend** — FastAPI (`backend/main.py`), exposing:
  - `POST /api/jarvis` — Daisy AI agent powered by the **Google Gemini API**.
    Falls back to a local rule-based mode if the Gemini request fails or the key
    is missing.
  - `POST /api/tts` — **local neural text-to-speech** (Piper). Returns a WAV so the
    voice is a consistent, clear female voice regardless of the OS's installed voices.
    Falls back to macOS `say`, and the frontend falls back to browser speech if the
    backend is unavailable.
  - `POST /api/stt` — **local speech-to-text** (faster-whisper). Transcribes a recorded
    audio clip, powering Daisy's always-listening voice mode.
  - `GET`/`POST /api/apple-health` — Apple Health telemetry.
  - `GET /healthz` — liveness probe.
  - Serves the built frontend (`dist/`) as static files in production.
- **Electron** (`electron/main.cjs`) — **automatically launches the FastAPI
  backend on startup**, waits until it's healthy, then loads the UI.
  - Dev: loads the Vite dev server (port 3000), which proxies `/api` → backend (port 8000).
  - Prod: loads a packaged backend executable from Electron resources, which serves the static UI + API.

## Prerequisites

- **Node.js**
- **Python 3.10+** (`python3` on your PATH)
- **Google Gemini API key** — create a key and set `GEMINI_API_KEY` in your
  root `.env` file.

## Setup

1. Install Node dependencies:
   ```
   npm install
   ```
2. Set up the Python backend (creates `backend/.venv`, installs deps, and
   downloads the ~61MB Piper voice model into `backend/voices/`):
   ```
   npm run backend:setup
   ```
3. Create a root `.env` file from [.env.example](.env.example) and set
  `GEMINI_API_KEY`. Optionally override `GEMINI_MODEL` if you want a different
  Gemini variant. If the key is missing or invalid, the AI agent runs in the
  local rule-based simulated mode.

## Run

### Desktop app (Electron) — recommended

```
npm run electron:dev
```

This starts Vite, then launches Electron, which spawns the FastAPI backend
automatically. No separate backend command needed.

### Backend only / frontend only (browser dev)

```
npm run backend:dev   # FastAPI on http://127.0.0.1:8000 (auto-reload)
npm run dev           # Vite on http://localhost:3000 (proxies /api → backend)
```

### Production-style single server (no Electron)

```
npm run start   # builds the UI, then serves UI + API from FastAPI on :8000
```

## Voice mode (always listening)

On the **Daisy** chat tab, click the microphone button next to the input to enable
always-listening. Then just talk:

1. Daisy continuously monitors the mic and detects when you start/stop speaking (VAD).
2. Your utterance is transcribed locally via `/api/stt` (faster-whisper).
3. The transcript is sent to Gemini like any message.
4. Daisy speaks the reply via `/api/tts` (Piper).

She pauses listening while she's talking, so she never transcribes her own voice.
The preference persists, and the first run prompts for microphone access. Speech
models are downloaded on first use (whisper `base.en`, ~140MB, cached) and warmed
in the background at startup so responses are snappy.

## Package the desktop app

- `npm run backend:build` — builds the standalone backend executable with PyInstaller into `backend/dist/daisy-backend`.
- `npm run electron:build` — builds the UI and packages a distributable (dmg/nsis/AppImage) into `release/`.
- `npm run electron:pack` — packages an unpacked app directory (quick local test, no installer).

> **Note on packaging:** the packaged app now ships with a bundled backend
> executable plus the frontend assets, so the exported app does not require a
> Python install at runtime.
