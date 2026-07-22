"""Spotify Connect integration for Daisy.

Daisy acts as a *remote control* for Spotify rather than an in-app player:
it authenticates via OAuth (Authorization Code + PKCE, so no client secret
has to ship inside the app), then drives playback on whichever Spotify
device is already running — the desktop app, your phone, a speaker, etc.

Why not play audio inside Daisy itself? Spotify's Web Playback SDK streams
DRM-protected audio and needs the Widevine CDM, which stock Electron builds
do not ship. Controlling an existing device via the Connect Web API needs no
DRM and is the supported path for a desktop app like this one.

Note that Spotify requires a Premium account for the playback *control*
endpoints; reading playlists and now-playing works on free accounts too.
"""

import base64
import hashlib
import json
import os
import re
import secrets
import sys
import time
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

# Playback control + reading playlists and the current player state.
SCOPES = " ".join([
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
])

def _client_id() -> str:
    """Read the client ID at call time, not import time.

    Keeps the app responsive to a .env edit + restart without depending on
    import ordering relative to load_dotenv().
    """
    return os.environ.get("SPOTIFY_CLIENT_ID", "").strip()


def _redirect_uri() -> str:
    """The OAuth redirect, which must match the Spotify dashboard exactly.

    Spotify permits plain http only for explicit loopback addresses, and wants
    127.0.0.1 rather than "localhost". The backend always listens there in both
    dev and packaged builds, so one registered URI covers every case.
    """
    port = os.environ.get("DAISY_API_PORT", "8000").strip() or "8000"
    return os.environ.get(
        "SPOTIFY_REDIRECT_URI", f"http://127.0.0.1:{port}/api/spotify/callback"
    ).strip()


def _user_data_dir() -> Path:
    """A writable per-user directory for the saved token.

    Deliberately never inside the app bundle: an installed .app in
    /Applications is read-only (and code-signed), so the token has to live in
    the platform's normal user-data location instead.
    """
    override = os.environ.get("DAISY_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Daisy"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "Daisy"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "daisy"


TOKEN_FILE = _user_data_dir() / "spotify_token.json"

# In-flight PKCE handshakes, keyed by the OAuth `state` value.
_pending_auth: dict[str, str] = {}
# Cached token document: {access_token, refresh_token, expires_at, scope}.
_token: Optional[dict[str, Any]] = None


# --- Token persistence -----------------------------------------------------


def _load_token() -> Optional[dict[str, Any]]:
    global _token
    if _token is not None:
        return _token
    try:
        if TOKEN_FILE.exists():
            _token = json.loads(TOKEN_FILE.read_text())
    except Exception as err:  # noqa: BLE001 — a corrupt token is not fatal
        print(f"Spotify: could not read saved token ({err}); re-auth needed.")
        _token = None
    return _token


def _save_token(doc: dict[str, Any]) -> None:
    global _token
    _token = doc
    try:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(doc))
        # Tokens are account credentials — keep them owner-only.
        try:
            os.chmod(TOKEN_FILE, 0o600)
        except OSError:
            pass
    except Exception as err:  # noqa: BLE001
        print(f"Spotify: could not persist token ({err}).")


def is_connected() -> bool:
    """Cheap synchronous check for "has the user linked Spotify?".

    Used to tailor the assistant's system prompt. Only proves a saved token
    exists, not that it still works — the API calls surface that themselves.
    """
    return bool(_client_id()) and bool(_load_token())


def _clear_token() -> None:
    global _token
    _token = None
    try:
        TOKEN_FILE.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


# --- OAuth -----------------------------------------------------------------


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for the PKCE handshake."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def _store_token_response(payload: dict[str, Any], fallback_refresh: str = "") -> None:
    # Spotify only sometimes returns a fresh refresh_token on renewal; when it
    # doesn't, the existing one stays valid and must be carried forward.
    refresh = payload.get("refresh_token") or fallback_refresh
    _save_token({
        "access_token": payload.get("access_token", ""),
        "refresh_token": refresh,
        "scope": payload.get("scope", ""),
        "expires_at": time.time() + float(payload.get("expires_in", 3600)),
    })


async def _refresh_access_token(token: dict[str, Any]) -> Optional[dict[str, Any]]:
    refresh = token.get("refresh_token")
    if not refresh:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh,
                    "client_id": _client_id(),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if res.status_code != 200:
            print(f"Spotify: token refresh failed ({res.status_code}) {res.text[:200]}")
            # A revoked/invalid refresh token can never recover — force re-auth.
            if res.status_code in (400, 401):
                _clear_token()
            return None
        _store_token_response(res.json(), fallback_refresh=refresh)
        return _token
    except Exception as err:  # noqa: BLE001
        print(f"Spotify: token refresh error ({err}).")
        return None


async def _access_token() -> Optional[str]:
    """Current access token, refreshed if it is expired or about to be."""
    token = _load_token()
    if not token:
        return None
    if time.time() >= float(token.get("expires_at", 0)) - 60:
        token = await _refresh_access_token(token)
        if not token:
            return None
    return token.get("access_token") or None


# --- Spotify API helper ----------------------------------------------------


class SpotifyError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def _api(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
) -> Any:
    """Call the Spotify Web API, translating its quirks into clear errors."""
    token = await _access_token()
    if not token:
        raise SpotifyError(401, "Spotify isn't connected. Connect your account first.")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.request(
                method,
                f"{API_BASE}{path}",
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception as err:  # noqa: BLE001
        raise SpotifyError(503, f"Could not reach Spotify: {err}") from err

    # Player endpoints answer 204 (success, no body) constantly.
    if res.status_code == 204 or not res.content:
        return None
    if res.status_code == 401:
        raise SpotifyError(401, "Spotify session expired. Reconnect your account.")
    if res.status_code == 403:
        # Overwhelmingly this means "not Premium" on the control endpoints.
        raise SpotifyError(403, "Spotify rejected that. Playback control requires Spotify Premium.")
    if res.status_code == 404:
        raise SpotifyError(404, "No active Spotify device. Open Spotify on any device, play something briefly, then retry.")
    if res.status_code == 429:
        raise SpotifyError(429, "Spotify is rate-limiting requests. Try again shortly.")
    if res.status_code >= 400:
        detail = ""
        try:
            detail = res.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = res.text[:200]
        raise SpotifyError(res.status_code, detail or f"Spotify error {res.status_code}")

    try:
        return res.json()
    except Exception:  # noqa: BLE001
        return None


router = APIRouter(prefix="/api/spotify", tags=["spotify"])


def _error_response(err: SpotifyError) -> JSONResponse:
    return JSONResponse(status_code=err.status, content={"error": err.message})


# --- Auth routes -----------------------------------------------------------


@router.get("/status")
async def status() -> JSONResponse:
    """Whether Spotify is set up and connected (never throws — the UI polls this)."""
    if not _client_id():
        return JSONResponse(content={
            "configured": False,
            "connected": False,
            "redirectUri": _redirect_uri(),
        })

    token = _load_token()
    if not token:
        return JSONResponse(content={"configured": True, "connected": False, "redirectUri": _redirect_uri()})

    try:
        me = await _api("GET", "/me")
    except SpotifyError:
        return JSONResponse(content={"configured": True, "connected": False, "redirectUri": _redirect_uri()})

    return JSONResponse(content={
        "configured": True,
        "connected": True,
        "redirectUri": _redirect_uri(),
        "user": {
            "id": (me or {}).get("id"),
            "name": (me or {}).get("display_name"),
            "product": (me or {}).get("product"),  # "premium" | "free"
        },
    })


@router.get("/login")
async def login() -> JSONResponse:
    """Build the Spotify consent URL for the frontend to open in a browser."""
    if not _client_id():
        return JSONResponse(status_code=400, content={
            "error": "SPOTIFY_CLIENT_ID is not set. Add it to your .env and restart Daisy."
        })

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(16)
    _pending_auth[state] = verifier
    # Don't let abandoned attempts pile up forever.
    if len(_pending_auth) > 20:
        for key in list(_pending_auth)[:-10]:
            _pending_auth.pop(key, None)

    from urllib.parse import urlencode

    query = urlencode({
        "client_id": _client_id(),
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "scope": SCOPES,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
        # Always re-prompt so switching accounts is possible.
        "show_dialog": "true",
    })
    return JSONResponse(content={"url": f"{AUTH_URL}?{query}"})


def _callback_page(title: str, message: str, ok: bool) -> HTMLResponse:
    color = "#16a34a" if ok else "#dc2626"
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8">
<title>Daisy &middot; Spotify</title><style>
html,body{{height:100%;margin:0;background:#f5efe6;color:#4a3f35;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}}
body{{display:flex;align-items:center;justify-content:center;flex-direction:column;
text-align:center;padding:24px;}}
h1{{font-size:20px;margin:0 0 8px;color:{color};}}
p{{font-size:14px;opacity:.75;max-width:420px;margin:0;}}
</style></head><body><h1>{title}</h1><p>{message}</p></body></html>""")


@router.get("/callback")
async def callback(request: Request) -> HTMLResponse:
    """Spotify redirects the user's browser here after they approve access."""
    params = request.query_params
    error = params.get("error")
    if error:
        return _callback_page("Spotify connection cancelled", f"Spotify reported: {error}", False)

    code = params.get("code")
    state = params.get("state") or ""
    verifier = _pending_auth.pop(state, None)
    if not code or not verifier:
        return _callback_page(
            "Spotify connection failed",
            "That sign-in link expired or didn't match. Start the connection again from Daisy.",
            False,
        )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": _redirect_uri(),
                    "client_id": _client_id(),
                    "code_verifier": verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as err:  # noqa: BLE001
        return _callback_page("Spotify connection failed", f"Could not reach Spotify: {err}", False)

    if res.status_code != 200:
        detail = res.text[:200]
        print(f"Spotify: token exchange failed ({res.status_code}) {detail}")
        return _callback_page(
            "Spotify connection failed",
            "Spotify rejected the sign-in. Check that the redirect URI in your Spotify app "
            f"exactly matches {_redirect_uri()}",
            False,
        )

    _store_token_response(res.json())
    return _callback_page("Spotify connected", "You can close this tab and go back to Daisy.", True)


@router.post("/logout")
async def logout() -> JSONResponse:
    _clear_token()
    return JSONResponse(content={"ok": True})


# --- Library ---------------------------------------------------------------


def _playlist_summary(item: dict[str, Any]) -> dict[str, Any]:
    images = item.get("images") or []
    return {
        "id": item.get("id"),
        "uri": item.get("uri"),
        "name": item.get("name"),
        "owner": ((item.get("owner") or {}).get("display_name")),
        "trackCount": ((item.get("tracks") or {}).get("total", 0)),
        "image": images[0].get("url") if images else None,
    }


@router.get("/playlists")
async def playlists() -> JSONResponse:
    """The user's playlists (first 100, which covers virtually every library)."""
    try:
        items: list[dict[str, Any]] = []
        for offset in (0, 50):
            page = await _api("GET", "/me/playlists", params={"limit": 50, "offset": offset})
            batch = (page or {}).get("items") or []
            # Spotify can return nulls in this array for unavailable playlists.
            items.extend(p for p in batch if p)
            if len(batch) < 50:
                break
        return JSONResponse(content={"playlists": [_playlist_summary(p) for p in items]})
    except SpotifyError as err:
        return _error_response(err)


@router.get("/devices")
async def devices() -> JSONResponse:
    try:
        data = await _api("GET", "/me/player/devices")
        return JSONResponse(content={"devices": (data or {}).get("devices") or []})
    except SpotifyError as err:
        return _error_response(err)


def _now_playing_payload(state: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not state:
        return {"playing": False, "track": None, "device": None}
    item = state.get("item") or {}
    album = item.get("album") or {}
    images = album.get("images") or []
    device = state.get("device") or {}
    return {
        "playing": bool(state.get("is_playing")),
        "progressMs": state.get("progress_ms"),
        "shuffle": bool(state.get("shuffle_state")),
        "track": {
            "id": item.get("id"),
            "uri": item.get("uri"),
            "name": item.get("name"),
            "artist": ", ".join(a.get("name", "") for a in (item.get("artists") or [])),
            "album": album.get("name"),
            "durationMs": item.get("duration_ms"),
            "image": images[0].get("url") if images else None,
        } if item else None,
        "device": {
            "id": device.get("id"),
            "name": device.get("name"),
            "type": device.get("type"),
            "volumePercent": device.get("volume_percent"),
        } if device else None,
    }


@router.get("/now-playing")
async def now_playing() -> JSONResponse:
    try:
        state = await _api("GET", "/me/player")
        return JSONResponse(content=_now_playing_payload(state))
    except SpotifyError as err:
        # "No active device" is a normal idle state here, not a failure.
        if err.status == 404:
            return JSONResponse(content={"playing": False, "track": None, "device": None})
        return _error_response(err)


# --- Playback control ------------------------------------------------------


async def _active_device_id(preferred: Optional[str] = None) -> Optional[str]:
    """Pick a device to target: the caller's choice, else active, else any."""
    if preferred:
        return preferred
    data = await _api("GET", "/me/player/devices")
    device_list = (data or {}).get("devices") or []
    if not device_list:
        return None
    for d in device_list:
        if d.get("is_active"):
            return d.get("id")
    return device_list[0].get("id")


async def _start_playback(
    *, context_uri: Optional[str] = None, uris: Optional[list[str]] = None, device_id: Optional[str] = None
) -> None:
    target = await _active_device_id(device_id)
    if not target:
        raise SpotifyError(
            404,
            "No Spotify device found. Open the Spotify app on your Mac or phone, then try again.",
        )
    body: dict[str, Any] = {}
    if context_uri:
        body["context_uri"] = context_uri
    if uris:
        body["uris"] = uris
    await _api("PUT", "/me/player/play", params={"device_id": target}, json_body=body or None)


@router.put("/play")
async def play(request: Request) -> JSONResponse:
    """Resume, or start a specific playlist/album/track when given a URI."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — a bare resume has no body
        body = {}
    try:
        await _start_playback(
            context_uri=body.get("contextUri"),
            uris=body.get("uris"),
            device_id=body.get("deviceId"),
        )
        return JSONResponse(content={"ok": True})
    except SpotifyError as err:
        return _error_response(err)


@router.put("/pause")
async def pause() -> JSONResponse:
    try:
        await _api("PUT", "/me/player/pause")
        return JSONResponse(content={"ok": True})
    except SpotifyError as err:
        return _error_response(err)


@router.post("/next")
async def next_track() -> JSONResponse:
    try:
        await _api("POST", "/me/player/next")
        return JSONResponse(content={"ok": True})
    except SpotifyError as err:
        return _error_response(err)


@router.post("/previous")
async def previous_track() -> JSONResponse:
    try:
        await _api("POST", "/me/player/previous")
        return JSONResponse(content={"ok": True})
    except SpotifyError as err:
        return _error_response(err)


@router.put("/volume")
async def volume(request: Request) -> JSONResponse:
    body = await request.json()
    percent = int(max(0, min(100, float(body.get("percent", 50)))))
    try:
        await _api("PUT", "/me/player/volume", params={"volume_percent": percent})
        return JSONResponse(content={"ok": True, "percent": percent})
    except SpotifyError as err:
        return _error_response(err)


@router.put("/shuffle")
async def shuffle(request: Request) -> JSONResponse:
    body = await request.json()
    state = bool(body.get("state", True))
    try:
        await _api("PUT", "/me/player/shuffle", params={"state": str(state).lower()})
        return JSONResponse(content={"ok": True, "state": state})
    except SpotifyError as err:
        return _error_response(err)


@router.put("/transfer")
async def transfer(request: Request) -> JSONResponse:
    """Move playback to a specific device."""
    body = await request.json()
    device_id = body.get("deviceId")
    if not device_id:
        return JSONResponse(status_code=400, content={"error": "deviceId is required"})
    try:
        await _api("PUT", "/me/player", json_body={"device_ids": [device_id], "play": bool(body.get("play", True))})
        return JSONResponse(content={"ok": True})
    except SpotifyError as err:
        return _error_response(err)


# --- Natural-language play (used by Daisy's voice commands) ----------------


# Words people say to a voice assistant that are never part of a playlist name.
# Deliberately conservative: words like "songs" or "music" are left in, because
# they really do appear in names ("Love Songs", "Sad Songs").
_FILLER_WORDS = {
    "play", "start", "put", "please", "spotify", "playlist", "playlists",
    "my", "the", "some", "from", "on", "in", "to", "of", "a", "an",
}
# How closely a name must match before we will play it without asking.
_MIN_CONFIDENT_SCORE = 0.55


def _tokens(text: str) -> list[str]:
    """Lowercase word tokens, ignoring punctuation and emoji in playlist names."""
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _match_score(query_tokens: list[str], name: str) -> float:
    """0..1 similarity between the spoken request and a playlist name.

    Scores both directions on purpose. Coverage alone would rank a playlist
    called "Love" as a perfect match for "love songs"; precision alone would
    rank a huge name containing the words just as highly. Weighing them together
    makes "Love Songs" win over both "Love" and "Love Songs For Late Night".
    """
    name_tokens = _tokens(name)
    if not name_tokens or not query_tokens:
        return 0.0
    if name_tokens == query_tokens:
        return 1.0
    q, n = set(query_tokens), set(name_tokens)
    shared = q & n
    if not shared:
        return 0.0
    coverage = len(shared) / len(q)  # how much of what was asked for is present
    precision = len(shared) / len(n)  # how much of the name is relevant
    return 0.7 * coverage + 0.3 * precision


def _best_playlist_match(query_tokens: list[str], items: list[dict[str, Any]]):
    """Highest-scoring playlist, or (None, 0.0). Ties break toward shorter names."""
    best, best_score = None, 0.0
    for p in items:
        s = _match_score(query_tokens, p.get("name") or "")
        # Strictly-greater keeps the first of an exact tie, so break ties
        # explicitly on name length rather than on Spotify's arbitrary ordering.
        if s > best_score or (
            s == best_score and best is not None
            and len(_tokens(p.get("name") or "")) < len(_tokens(best.get("name") or ""))
        ):
            best, best_score = p, s
    return best, best_score


async def _all_own_playlists() -> list[dict[str, Any]]:
    """Every playlist in the user's library, not just the first page."""
    items: list[dict[str, Any]] = []
    for offset in range(0, 200, 50):
        page = await _api("GET", "/me/playlists", params={"limit": 50, "offset": offset})
        batch = (page or {}).get("items") or []
        items.extend(p for p in batch if p)
        if len(batch) < 50:
            break
    return items


# Playlist names are injected into Daisy's system prompt on every turn, so they
# are cached rather than re-fetched from Spotify for each message.
_names_cache: dict[str, Any] = {"at": 0.0, "names": []}
_NAMES_TTL_SECONDS = 300


async def cached_playlist_names(limit: int = 80) -> list[str]:
    """Names of the user's playlists, cached, for the assistant's context.

    Never raises: if Spotify is unreachable the assistant simply gets an empty
    list and falls back to talking about music without naming playlists.
    """
    now = time.time()
    if now - float(_names_cache["at"]) < _NAMES_TTL_SECONDS and _names_cache["names"]:
        return _names_cache["names"]
    try:
        names = [n for n in ((p.get("name") or "").strip() for p in await _all_own_playlists()) if n]
    except Exception:  # noqa: BLE001 — context is a nicety, never a hard failure
        return _names_cache["names"]
    _names_cache["at"] = now
    _names_cache["names"] = names[:limit]
    return _names_cache["names"]


async def resolve_and_play(query: str, device_id: Optional[str] = None) -> dict[str, Any]:
    """Play whatever best matches a spoken phrase like "my focus playlist".

    Prefers the user's own playlists (that's what "my X playlist" almost always
    means). If the request explicitly says "my", a public Spotify result is never
    an acceptable answer — playing a stranger's playlist is worse than saying we
    could not find it.
    """
    wanted = (query or "").strip()
    if not wanted:
        raise SpotifyError(400, "No playlist or song name given.")

    query_tokens = [t for t in _tokens(wanted) if t not in _FILLER_WORDS]
    if not query_tokens:  # e.g. the user just said "play my playlist"
        query_tokens = _tokens(wanted)

    # "my ... playlist" is an explicit instruction to stay inside the library.
    own_only = bool(re.search(r"\bmy\b", wanted, re.I))

    own = await _all_own_playlists()
    best, best_score = _best_playlist_match(query_tokens, own)

    if best and best_score >= _MIN_CONFIDENT_SCORE:
        await _start_playback(context_uri=best.get("uri"), device_id=device_id)
        return {"kind": "playlist", "name": best.get("name"), "uri": best.get("uri")}

    if own_only:
        raise SpotifyError(
            404, f"I couldn't find a playlist called '{wanted}' in your library."
        )

    # Nothing convincing in the user's library — search Spotify itself. Rank the
    # public results by the same similarity measure instead of blindly taking the
    # first hit, which is how unrelated playlists ended up playing.
    found = await _api(
        "GET", "/search", params={"q": wanted, "type": "playlist,album,track,artist", "limit": 10}
    )
    found = found or {}

    for key, kind in (("playlists", "playlist"), ("albums", "album"), ("artists", "artist")):
        items = [i for i in ((found.get(key) or {}).get("items") or []) if i]
        if not items:
            continue
        pick, score = _best_playlist_match(query_tokens, items)
        if pick and score >= _MIN_CONFIDENT_SCORE:
            await _start_playback(context_uri=pick.get("uri"), device_id=device_id)
            return {"kind": kind, "name": pick.get("name"), "uri": pick.get("uri")}

    # A track is the safest fallback: Spotify's track search is a much better
    # ranker for song titles than name similarity is.
    tracks = [i for i in ((found.get("tracks") or {}).get("items") or []) if i]
    if tracks:
        await _start_playback(uris=[tracks[0].get("uri")], device_id=device_id)
        return {"kind": "track", "name": tracks[0].get("name"), "uri": tracks[0].get("uri")}

    raise SpotifyError(404, f"Couldn't find anything on Spotify matching '{wanted}'.")


@router.put("/play-query")
async def play_query(request: Request) -> JSONResponse:
    body = await request.json()
    try:
        result = await resolve_and_play(body.get("query", ""), body.get("deviceId"))
        return JSONResponse(content={"ok": True, **result})
    except SpotifyError as err:
        return _error_response(err)


@router.get("/search")
async def search(q: str = "", type: str = "playlist,track,album,artist", limit: int = 10) -> JSONResponse:
    if not q.strip():
        return JSONResponse(content={"results": {}})
    try:
        data = await _api("GET", "/search", params={"q": q, "type": type, "limit": limit})
        return JSONResponse(content={"results": data or {}})
    except SpotifyError as err:
        return _error_response(err)
