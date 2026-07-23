"""Google Calendar integration for Daisy.

Mirrors backend/spotify.py: the backend owns the OAuth handshake and the saved
token, and the frontend only ever talks to /api/gcal/*. Tokens are written to
the per-user data directory (never into the app bundle, which is read-only once
installed) with owner-only permissions.

Setup: create an OAuth client of type "Desktop app" in Google Cloud Console,
enable the Google Calendar API, then set GOOGLE_CLIENT_ID (and, for the desktop
client type, GOOGLE_CLIENT_SECRET) in your .env and restart Daisy.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API_BASE = "https://www.googleapis.com/calendar/v3"

# Read and write events on the user's calendars, plus their email for display.
SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "email",
])


def _client_id() -> str:
    """Read credentials at call time so a .env edit + restart is enough."""
    return os.environ.get("GOOGLE_CLIENT_ID", "").strip()


def _client_secret() -> str:
    return os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()


def _redirect_uri() -> str:
    """Loopback redirect, which must match the Google client's registered URI."""
    port = os.environ.get("DAISY_API_PORT", "8000").strip() or "8000"
    return os.environ.get(
        "GOOGLE_REDIRECT_URI", f"http://127.0.0.1:{port}/api/gcal/callback"
    ).strip()


def _user_data_dir() -> Path:
    """A writable per-user directory for the saved token."""
    override = os.environ.get("DAISY_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Daisy"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "Daisy"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "daisy"


TOKEN_FILE = _user_data_dir() / "gcal_token.json"

# In-flight PKCE handshakes, keyed by the OAuth `state` value.
_pending_auth: dict[str, str] = {}
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
        print(f"Google Calendar: could not read saved token ({err}); re-auth needed.")
        _token = None
    return _token


def _save_token(doc: dict[str, Any]) -> None:
    global _token
    _token = doc
    try:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(doc))
        try:
            os.chmod(TOKEN_FILE, 0o600)
        except OSError:
            pass
    except Exception as err:  # noqa: BLE001
        print(f"Google Calendar: could not persist token ({err}).")


def is_connected() -> bool:
    """Cheap synchronous check for "has the user linked Google Calendar?"."""
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
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def _store_token_response(payload: dict[str, Any], fallback_refresh: str = "") -> None:
    # Google only returns refresh_token on the first consent (or when prompted
    # again), so an existing one must be carried forward across refreshes.
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
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": _client_id(),
    }
    if _client_secret():
        data["client_secret"] = _client_secret()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(TOKEN_URL, data=data)
        if res.status_code != 200:
            print(f"Google Calendar: token refresh failed ({res.status_code}) {res.text[:200]}")
            # A revoked or invalid refresh token can never recover.
            if res.status_code in (400, 401):
                _clear_token()
            return None
        _store_token_response(res.json(), fallback_refresh=refresh)
        return _token
    except Exception as err:  # noqa: BLE001
        print(f"Google Calendar: token refresh error ({err}).")
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


# --- API helper ------------------------------------------------------------


class GCalError(Exception):
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
    """Call the Google Calendar API, translating errors into clear messages."""
    token = await _access_token()
    if not token:
        raise GCalError(401, "Google Calendar isn't connected. Connect your account first.")

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.request(
                method,
                f"{API_BASE}{path}",
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception as err:  # noqa: BLE001
        raise GCalError(503, f"Could not reach Google Calendar: {err}") from err

    if res.status_code == 204 or not res.content:
        return None
    if res.status_code == 401:
        raise GCalError(401, "Google session expired. Reconnect your Google account.")
    if res.status_code == 403:
        detail = ""
        try:
            detail = res.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            pass
        # Overwhelmingly this is the API not being enabled on the project.
        raise GCalError(403, detail or "Google rejected that request. Is the Calendar API enabled?")
    if res.status_code == 404:
        raise GCalError(404, "That calendar or event no longer exists.")
    if res.status_code == 429:
        raise GCalError(429, "Google is rate-limiting requests. Try again shortly.")
    if res.status_code >= 400:
        detail = ""
        try:
            detail = res.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = res.text[:200]
        raise GCalError(res.status_code, detail or f"Google Calendar error {res.status_code}")

    try:
        return res.json()
    except Exception:  # noqa: BLE001
        return None


# --- Event shape translation ----------------------------------------------
#
# Daisy stores naive local times as "YYYY-MM-DDTHH:MM". Google wants RFC3339.
# Rather than depend on an IANA timezone database, times are sent with this
# machine's current UTC offset, which Google accepts and resolves correctly.


def _local_offset() -> timezone:
    return datetime.now().astimezone().tzinfo or timezone.utc


_tz_name_cache: list[str] = []


def _local_tz_name() -> str:
    """This machine's IANA zone name, e.g. "Asia/Kolkata".

    A bare UTC offset is enough for one-off events, but Google rejects a
    recurring event without a real zone: an RRULE has to know which wall clock
    to repeat against, and only a named zone carries DST rules.
    """
    if _tz_name_cache:
        return _tz_name_cache[0]

    name = ""
    env = (os.environ.get("TZ") or "").strip()
    if "/" in env:
        name = env
    else:
        # macOS and most Linux distros symlink /etc/localtime into the tzdata tree.
        try:
            target = os.path.realpath("/etc/localtime")
            if "zoneinfo/" in target:
                name = target.split("zoneinfo/", 1)[1].strip("/")
        except OSError:
            name = ""

    _tz_name_cache.append(name)
    return name


def _to_rfc3339(local_naive: str) -> str:
    """"YYYY-MM-DDTHH:MM" (local) -> RFC3339 with this machine's offset."""
    text = (local_naive or "").strip()
    if not text:
        raise GCalError(400, "An event needs a start and end time.")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as err:
        raise GCalError(400, f"Could not understand the date/time '{local_naive}'.") from err
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_local_offset())
    return dt.isoformat()


def _from_google_time(node: dict[str, Any]) -> str:
    """Google start/end node -> "YYYY-MM-DDTHH:MM" in local time."""
    node = node or {}
    raw = node.get("dateTime")
    if raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.astimezone().strftime("%Y-%m-%dT%H:%M")
        except ValueError:
            return raw[:16]
    # All-day events carry a plain date; show them starting at midnight.
    day = node.get("date") or ""
    return f"{day}T00:00" if day else ""


def _all_day_end(node: dict[str, Any]) -> str:
    """
    Google's all-day `end.date` is *exclusive* — a one-day event on the 5th ends
    on the 6th. Shift back a day so the UI can treat start/end as inclusive like
    every other event, otherwise single-day events render as spanning two.
    """
    day = (node or {}).get("date") or ""
    if not day:
        return ""
    try:
        return (datetime.fromisoformat(day) - timedelta(days=1)).strftime("%Y-%m-%dT00:00")
    except ValueError:
        return f"{day}T00:00"


def _meet_link(item: dict[str, Any]) -> str:
    """Video-call URL, whether it came from Hangouts or modern conferenceData."""
    if item.get("hangoutLink"):
        return item["hangoutLink"]
    for entry in ((item.get("conferenceData") or {}).get("entryPoints") or []):
        if entry.get("entryPointType") == "video" and entry.get("uri"):
            return entry["uri"]
    return ""


def _event_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Google event -> the shape Daisy's frontend understands."""
    start_node = item.get("start") or {}
    end_node = item.get("end") or {}
    all_day = bool(start_node.get("date"))
    reminders = item.get("reminders") or {}

    return {
        "googleId": item.get("id"),
        "calendarId": item.get("_calendarId", "primary"),
        "title": item.get("summary") or "(no title)",
        "start": _from_google_time(start_node),
        "end": _all_day_end(end_node) if all_day else _from_google_time(end_node),
        "allDay": all_day,
        "description": item.get("description") or "",
        "location": item.get("location") or "",
        "colorId": item.get("colorId") or "",
        "status": item.get("status") or "confirmed",
        "htmlLink": item.get("htmlLink") or "",
        "meetLink": _meet_link(item),
        # RRULE/EXDATE lines. Present only on the series master; instances
        # expanded via singleEvents carry recurringEventId instead.
        "recurrence": item.get("recurrence") or [],
        "recurringEventId": item.get("recurringEventId") or "",
        "reminders": {
            "useDefault": bool(reminders.get("useDefault", True)),
            "overrides": [
                {"method": o.get("method", "popup"), "minutes": int(o.get("minutes", 0))}
                for o in (reminders.get("overrides") or [])
            ],
        },
        "attendees": [
            {
                "email": a.get("email", ""),
                "displayName": a.get("displayName", ""),
                "responseStatus": a.get("responseStatus", "needsAction"),
                "optional": bool(a.get("optional")),
                "organizer": bool(a.get("organizer")),
                "self": bool(a.get("self")),
            }
            for a in (item.get("attendees") or [])
        ],
        "organizer": {
            "email": (item.get("organizer") or {}).get("email", ""),
            "displayName": (item.get("organizer") or {}).get("displayName", ""),
            "self": bool((item.get("organizer") or {}).get("self")),
        },
        "transparency": item.get("transparency") or "opaque",
        "visibility": item.get("visibility") or "default",
        "updated": item.get("updated") or "",
    }


def _to_google_body(event: dict[str, Any]) -> dict[str, Any]:
    """Daisy's event shape -> a Google Calendar request body.

    Only keys actually present are emitted, so this doubles as the PATCH body:
    sending a partial event updates just those fields.
    """
    body: dict[str, Any] = {}

    if event.get("title") is not None:
        body["summary"] = event.get("title") or "Untitled event"
    for key, field in (("description", "description"), ("location", "location")):
        if event.get(key) is not None:
            body[field] = event.get(key) or ""
    if event.get("colorId"):
        body["colorId"] = str(event["colorId"])
    if event.get("transparency"):
        body["transparency"] = event["transparency"]
    if event.get("visibility"):
        body["visibility"] = event["visibility"]

    start = event.get("start")
    if start:
        end = event.get("end") or start
        if event.get("allDay"):
            # Back to Google's exclusive end date (see _all_day_end).
            start_day = str(start)[:10]
            try:
                end_day = (
                    datetime.fromisoformat(str(end)[:10]) + timedelta(days=1)
                ).strftime("%Y-%m-%d")
            except ValueError:
                end_day = start_day
            body["start"] = {"date": start_day}
            body["end"] = {"date": end_day}
        else:
            body["start"] = {"dateTime": _to_rfc3339(str(start))}
            body["end"] = {"dateTime": _to_rfc3339(str(end))}
            # Required by Google whenever a recurrence rule is attached, and
            # harmless otherwise — so always send it when we can name the zone.
            tz_name = _local_tz_name()
            if tz_name:
                body["start"]["timeZone"] = tz_name
                body["end"]["timeZone"] = tz_name

    if event.get("recurrence") is not None:
        # [] clears the rule and turns a series back into a single event.
        body["recurrence"] = [str(r) for r in (event.get("recurrence") or [])]

    reminders = event.get("reminders")
    if isinstance(reminders, dict):
        overrides = [
            {"method": o.get("method", "popup"), "minutes": int(o.get("minutes", 0))}
            for o in (reminders.get("overrides") or [])
        ]
        if overrides:
            body["reminders"] = {"useDefault": False, "overrides": overrides[:5]}
        else:
            body["reminders"] = {"useDefault": True}

    attendees = event.get("attendees")
    if attendees is not None:
        body["attendees"] = [
            {
                "email": a.get("email", ""),
                **({"optional": True} if a.get("optional") else {}),
            }
            for a in attendees
            if (a or {}).get("email")
        ]

    return body


# --- Routes ----------------------------------------------------------------

router = APIRouter(prefix="/api/gcal", tags=["gcal"])


def _error_response(err: GCalError) -> JSONResponse:
    return JSONResponse(status_code=err.status, content={"error": err.message})


@router.get("/status")
async def status() -> JSONResponse:
    """Whether Google Calendar is set up and connected (never throws)."""
    if not _client_id():
        return JSONResponse(content={
            "configured": False, "connected": False, "redirectUri": _redirect_uri(),
        })
    if not _load_token():
        return JSONResponse(content={
            "configured": True, "connected": False, "authorized": False,
            "redirectUri": _redirect_uri(),
        })
    try:
        cal = await _api("GET", "/calendars/primary")
    except GCalError as err:
        # A saved token that Google then rejects is a completely different
        # problem from having no token at all — most often the Calendar API is
        # not enabled on the project. Reporting a bare "not connected" sends the
        # user back through a sign-in that already succeeded, so pass the real
        # reason through for the UI to show.
        return JSONResponse(content={
            "configured": True,
            "connected": False,
            "authorized": True,
            "redirectUri": _redirect_uri(),
            "error": err.message,
        })
    return JSONResponse(content={
        "configured": True,
        "connected": True,
        "redirectUri": _redirect_uri(),
        "account": {
            "id": (cal or {}).get("id"),
            "summary": (cal or {}).get("summary"),
            "timeZone": (cal or {}).get("timeZone"),
        },
    })


@router.get("/login")
async def login() -> JSONResponse:
    """Build the Google consent URL for the frontend to open in a browser."""
    if not _client_id():
        return JSONResponse(status_code=400, content={
            "error": "GOOGLE_CLIENT_ID is not set. Add it to your .env and restart Daisy."
        })

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(16)
    _pending_auth[state] = verifier
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
        # Both are required to be issued a refresh token by Google.
        "access_type": "offline",
        "prompt": "consent",
    })
    return JSONResponse(content={"url": f"{AUTH_URL}?{query}"})


def _callback_page(title: str, message: str, ok: bool) -> HTMLResponse:
    color = "#16a34a" if ok else "#dc2626"
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8">
<title>Daisy &middot; Google Calendar</title><style>
html,body{{height:100%;margin:0;background:#f5efe6;color:#4a3f35;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}}
body{{display:flex;align-items:center;justify-content:center;flex-direction:column;
text-align:center;padding:24px;}}
h1{{font-size:20px;margin:0 0 8px;color:{color};}}
p{{font-size:14px;opacity:.75;max-width:420px;margin:0;}}
</style></head><body><h1>{title}</h1><p>{message}</p></body></html>""")


@router.get("/callback")
async def callback(request: Request) -> HTMLResponse:
    """Google redirects the user's browser here after they approve access."""
    params = request.query_params
    error = params.get("error")
    if error:
        return _callback_page("Google connection cancelled", f"Google reported: {error}", False)

    code = params.get("code")
    state = params.get("state") or ""
    verifier = _pending_auth.pop(state, None)
    if not code or not verifier:
        return _callback_page(
            "Google connection failed",
            "That sign-in link expired or didn't match. Start the connection again from Daisy.",
            False,
        )

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(),
        "client_id": _client_id(),
        "code_verifier": verifier,
    }
    if _client_secret():
        data["client_secret"] = _client_secret()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(TOKEN_URL, data=data)
    except Exception as err:  # noqa: BLE001
        return _callback_page("Google connection failed", f"Could not reach Google: {err}", False)

    if res.status_code != 200:
        print(f"Google Calendar: token exchange failed ({res.status_code}) {res.text[:300]}")
        return _callback_page(
            "Google connection failed",
            "Google rejected the sign-in. Check that the redirect URI on your OAuth client "
            f"exactly matches {_redirect_uri()}",
            False,
        )

    payload = res.json()
    if not payload.get("refresh_token"):
        # Without one, the connection silently dies in an hour.
        print("Google Calendar: no refresh_token returned; the grant may need to be revoked and redone.")
    _store_token_response(payload)
    return _callback_page("Google Calendar connected", "You can close this tab and go back to Daisy.", True)


@router.post("/logout")
async def logout() -> JSONResponse:
    """Disconnect, revoking the grant with Google where possible."""
    token = _load_token() or {}
    refresh = token.get("refresh_token") or token.get("access_token")
    if refresh:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(REVOKE_URL, params={"token": refresh})
        except Exception:  # noqa: BLE001 — local disconnect must still succeed
            pass
    _clear_token()
    return JSONResponse(content={"ok": True})


# --- Events ----------------------------------------------------------------


def _quote(value: str) -> str:
    """Percent-encode a calendar/event id for use in a path segment."""
    return urllib.parse.quote(str(value or "primary"), safe="")


async def list_calendars() -> list[dict[str, Any]]:
    """Every calendar in the user's list, with the colours Google shows."""
    data = await _api("GET", "/users/me/calendarList", params={"maxResults": 250})
    out: list[dict[str, Any]] = []
    for item in ((data or {}).get("items") or []):
        if not item:
            continue
        role = item.get("accessRole", "reader")
        out.append({
            "id": item.get("id", ""),
            "summary": item.get("summaryOverride") or item.get("summary") or item.get("id", ""),
            "description": item.get("description") or "",
            "primary": bool(item.get("primary")),
            "selected": bool(item.get("selected", item.get("primary", False))),
            "backgroundColor": item.get("backgroundColor") or "#4285f4",
            "foregroundColor": item.get("foregroundColor") or "#ffffff",
            "timeZone": item.get("timeZone") or "",
            "accessRole": role,
            # Anything below writer is read-only; the UI disables editing for these.
            "canEdit": role in ("owner", "writer"),
        })
    # Primary first, then alphabetically — matches Google's own ordering.
    out.sort(key=lambda c: (not c["primary"], c["summary"].lower()))
    return out


async def _events_for_calendar(
    calendar_id: str,
    time_min: str,
    time_max: str,
    limit: int,
    query: str = "",
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",   # expand recurring events into instances
        "orderBy": "startTime",
        "maxResults": limit,
    }
    if query:
        params["q"] = query
    data = await _api("GET", f"/calendars/{_quote(calendar_id)}/events", params=params)
    items = [i for i in ((data or {}).get("items") or []) if i]
    out = []
    for item in items:
        # Cancelled instances of recurring events come back as tombstones.
        if item.get("status") == "cancelled":
            continue
        item["_calendarId"] = calendar_id
        out.append(_event_summary(item))
    return out


async def list_events(
    past_days: int = 7,
    future_days: int = 60,
    limit: int = 250,
    calendar_ids: Optional[list[str]] = None,
    query: str = "",
) -> list[dict[str, Any]]:
    """Events across one or more calendars in a window around today."""
    now = datetime.now(_local_offset())
    time_min = (now - timedelta(days=max(0, past_days))).isoformat()
    time_max = (now + timedelta(days=max(1, future_days))).isoformat()

    ids = [c for c in (calendar_ids or []) if c]
    if not ids:
        ids = ["primary"]

    # One request per calendar, in parallel — Google has no cross-calendar list.
    results = await asyncio.gather(
        *[_events_for_calendar(cid, time_min, time_max, limit, query) for cid in ids],
        return_exceptions=True,
    )
    events: list[dict[str, Any]] = []
    for result in results:
        # A single unreadable calendar must not blank out the whole view.
        if isinstance(result, list):
            events.extend(result)
    events.sort(key=lambda e: (e.get("start") or "", e.get("title") or ""))
    return events


@router.get("/calendars")
async def get_calendars() -> JSONResponse:
    try:
        return JSONResponse(content={"calendars": await list_calendars()})
    except GCalError as err:
        return _error_response(err)


@router.get("/colors")
async def get_colors() -> JSONResponse:
    """Google's event colour palette, so Daisy can show the same swatches."""
    try:
        data = await _api("GET", "/colors")
        event_colors = ((data or {}).get("event") or {})
        return JSONResponse(content={
            "event": {
                key: {"background": val.get("background", ""), "foreground": val.get("foreground", "")}
                for key, val in event_colors.items()
            }
        })
    except GCalError as err:
        return _error_response(err)


@router.get("/events")
async def get_events(
    pastDays: int = 7,
    futureDays: int = 60,
    calendarIds: str = "",
    q: str = "",
) -> JSONResponse:
    ids = [c.strip() for c in calendarIds.split(",") if c.strip()]
    try:
        events = await list_events(pastDays, futureDays, calendar_ids=ids, query=q.strip())
        return JSONResponse(content={"events": events})
    except GCalError as err:
        return _error_response(err)


@router.post("/events")
async def create_event(request: Request) -> JSONResponse:
    body = await request.json()
    calendar_id = body.get("calendarId") or "primary"
    try:
        created = await _api(
            "POST",
            f"/calendars/{_quote(calendar_id)}/events",
            params={"sendUpdates": "all"} if body.get("attendees") else None,
            json_body=_to_google_body(body),
        )
        created = created or {}
        created["_calendarId"] = calendar_id
        return JSONResponse(content={"ok": True, "event": _event_summary(created)})
    except GCalError as err:
        return _error_response(err)


@router.post("/events/quick-add")
async def quick_add(request: Request) -> JSONResponse:
    """Natural-language event creation — Google parses "Lunch Friday at 1pm"."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    calendar_id = body.get("calendarId") or "primary"
    if not text:
        return _error_response(GCalError(400, "Say what to add, e.g. 'Lunch Friday at 1pm'."))
    try:
        created = await _api(
            "POST", f"/calendars/{_quote(calendar_id)}/events/quickAdd", params={"text": text}
        )
        created = created or {}
        created["_calendarId"] = calendar_id
        return JSONResponse(content={"ok": True, "event": _event_summary(created)})
    except GCalError as err:
        return _error_response(err)


@router.patch("/events/{event_id}")
async def update_event(event_id: str, request: Request, calendarId: str = "primary") -> JSONResponse:
    body = await request.json()
    calendar_id = body.get("calendarId") or calendarId or "primary"
    try:
        updated = await _api(
            "PATCH",
            f"/calendars/{_quote(calendar_id)}/events/{_quote(event_id)}",
            params={"sendUpdates": "all"} if body.get("attendees") else None,
            json_body=_to_google_body(body),
        )
        updated = updated or {}
        updated["_calendarId"] = calendar_id
        return JSONResponse(content={"ok": True, "event": _event_summary(updated)})
    except GCalError as err:
        return _error_response(err)


@router.post("/events/{event_id}/move")
async def move_event(event_id: str, request: Request) -> JSONResponse:
    """Move an event to a different calendar."""
    body = await request.json()
    source = body.get("calendarId") or "primary"
    destination = body.get("destination") or ""
    if not destination:
        return _error_response(GCalError(400, "Pick a calendar to move this event to."))
    try:
        moved = await _api(
            "POST",
            f"/calendars/{_quote(source)}/events/{_quote(event_id)}/move",
            params={"destination": destination},
        )
        moved = moved or {}
        moved["_calendarId"] = destination
        return JSONResponse(content={"ok": True, "event": _event_summary(moved)})
    except GCalError as err:
        return _error_response(err)


@router.post("/events/{event_id}/respond")
async def respond_to_event(event_id: str, request: Request) -> JSONResponse:
    """RSVP to an invitation (accepted / declined / tentative)."""
    body = await request.json()
    calendar_id = body.get("calendarId") or "primary"
    response = (body.get("response") or "").strip()
    if response not in ("accepted", "declined", "tentative", "needsAction"):
        return _error_response(GCalError(400, "RSVP must be accepted, declined or tentative."))
    try:
        current = await _api("GET", f"/calendars/{_quote(calendar_id)}/events/{_quote(event_id)}")
        attendees = (current or {}).get("attendees") or []
        # Only the "self" attendee row may carry our response.
        for attendee in attendees:
            if attendee.get("self"):
                attendee["responseStatus"] = response
        updated = await _api(
            "PATCH",
            f"/calendars/{_quote(calendar_id)}/events/{_quote(event_id)}",
            json_body={"attendees": attendees},
        )
        updated = updated or {}
        updated["_calendarId"] = calendar_id
        return JSONResponse(content={"ok": True, "event": _event_summary(updated)})
    except GCalError as err:
        return _error_response(err)


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, calendarId: str = "primary") -> JSONResponse:
    try:
        await _api(
            "DELETE",
            f"/calendars/{_quote(calendarId)}/events/{_quote(event_id)}",
            params={"sendUpdates": "all"},
        )
        return JSONResponse(content={"ok": True})
    except GCalError as err:
        return _error_response(err)


@router.get("/freebusy")
async def free_busy(start: str, end: str, calendarIds: str = "") -> JSONResponse:
    """Busy blocks across calendars — used to spot conflicts when scheduling."""
    ids = [c.strip() for c in calendarIds.split(",") if c.strip()] or ["primary"]
    try:
        data = await _api("POST", "/freeBusy", json_body={
            "timeMin": _to_rfc3339(start),
            "timeMax": _to_rfc3339(end),
            "items": [{"id": cid} for cid in ids],
        })
        calendars = ((data or {}).get("calendars") or {})
        busy = []
        for cid, node in calendars.items():
            for block in (node.get("busy") or []):
                busy.append({
                    "calendarId": cid,
                    "start": _from_google_time({"dateTime": block.get("start")}),
                    "end": _from_google_time({"dateTime": block.get("end")}),
                })
        busy.sort(key=lambda b: b["start"])
        return JSONResponse(content={"busy": busy})
    except GCalError as err:
        return _error_response(err)


# --- Assistant context -----------------------------------------------------

_upcoming_cache: dict[str, Any] = {"at": 0.0, "events": []}
_UPCOMING_TTL_SECONDS = 120


async def cached_upcoming(limit: int = 15) -> list[dict[str, Any]]:
    """Near-term events for Daisy's system prompt. Never raises."""
    now = time.time()
    if now - float(_upcoming_cache["at"]) < _UPCOMING_TTL_SECONDS and _upcoming_cache["events"]:
        return _upcoming_cache["events"]
    try:
        events = await list_events(past_days=0, future_days=14, limit=50)
    except Exception:  # noqa: BLE001 — context is a nicety, never a hard failure
        return _upcoming_cache["events"]
    _upcoming_cache["at"] = now
    _upcoming_cache["events"] = events[:limit]
    return _upcoming_cache["events"]
