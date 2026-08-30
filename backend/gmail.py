"""Gmail integration for Daisy.

Shares the single Google OAuth connection that backend/gcal.py owns — the same
token, refresh handling and consent flow. There is no separate Gmail login:
connecting Google Calendar also authorises the inbox (the token carries Gmail
scopes), which is why this module reuses gcal's token accessor rather than
running its own handshake.

Consent is handled here rather than in the renderer because a browser-style
sign-in popup cannot work inside Electron: it needs a real web origin to post
the result back to, and the token it yields is short-lived with no refresh.
"""

from __future__ import annotations

import asyncio
import base64
import re
from html import unescape
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import gcal

API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"

router = APIRouter(prefix="/api/gmail", tags=["gmail"])


class GmailError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _error(err: GmailError) -> JSONResponse:
    return JSONResponse(status_code=err.status, content={"error": err.message})


async def _api(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
) -> Any:
    """Call the Gmail REST API with the shared Google token."""
    token = await gcal.access_token()
    if not token:
        raise GmailError(401, "Google isn't connected. Connect your Google account first.")

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
        raise GmailError(503, f"Could not reach Gmail: {err}") from err

    if res.status_code == 204 or not res.content:
        return None
    if res.status_code == 401:
        raise GmailError(401, "Google session expired. Reconnect your Google account.")
    if res.status_code == 403:
        detail = ""
        try:
            detail = res.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            pass
        # Usually: Gmail scope not granted yet, or the Gmail API not enabled.
        raise GmailError(
            403,
            detail or "Google rejected the request. Reconnect Google and allow Gmail access.",
        )
    if res.status_code == 404:
        raise GmailError(404, "That message no longer exists.")
    if res.status_code == 429:
        raise GmailError(429, "Gmail is rate-limiting requests. Try again shortly.")
    if res.status_code >= 400:
        detail = ""
        try:
            detail = res.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = res.text[:200]
        raise GmailError(res.status_code, detail or f"Gmail error {res.status_code}")

    try:
        return res.json()
    except Exception:  # noqa: BLE001
        return None


# --- Message parsing -------------------------------------------------------


def _header(headers: list[dict[str, Any]], name: str) -> str:
    lname = name.lower()
    for h in headers or []:
        if (h.get("name") or "").lower() == lname:
            return h.get("value") or ""
    return ""


def _decode_part(data: str) -> str:
    """Gmail bodies are base64url with padding stripped."""
    if not data:
        return ""
    try:
        padded = data + "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""


# Marketing senders pad the preheader with runs of invisible characters so the
# inbox preview line looks clean, which is why a stripped Indeed/LinkedIn mail
# turns into "&#8199;&#847;&shy;" repeated hundreds of times. They fall into
# three groups that must be handled differently.
#
# Genuinely zero-width - deleted outright, matching what a mail client draws.
_ZERO_WIDTH_RE = re.compile("[\u00ad\u200b\u200c\u200d\u034f\ufeff]+")
# Exotic spaces (no-break, figure, thin, ideographic...). These *do* occupy
# width, so they collapse to an ordinary space; deleting them would glue
# neighbouring words together ("D02HE36").
_UNICODE_SPACE_RE = re.compile("[\u00a0\u2000-\u200a\u202f\u205f\u3000]+")
# Unicode line/paragraph separators are real breaks.
_LINE_SEP_RE = re.compile("[\u2028\u2029]+")


def _strip_invisibles(text: str) -> str:
    text = _ZERO_WIDTH_RE.sub("", text)
    text = _LINE_SEP_RE.sub("\n", text)
    return _UNICODE_SPACE_RE.sub(" ", text)

# Tags whose boundaries are real line breaks in the rendered mail.
_BLOCK_TAGS = r"p|div|br|tr|li|h[1-6]|table|section|header|footer|blockquote|hr"


def _html_to_text(html_source: str) -> str:
    """Convert an HTML mail part to readable plain text.

    Order matters: entities are decoded *after* tags are removed (so a literal
    "&lt;b&gt;" in the body can't turn into a tag we then strip), and invisible
    characters are removed *after* decoding, because they mostly arrive
    entity-encoded (&#8203;, &shy;) rather than raw.
    """
    text = html_source
    # Anything non-visible in the rendered mail.
    text = re.sub(r"(?is)<(script|style|head|title)\b.*?</\1\s*>", " ", text)
    text = re.sub(r"(?s)<!--.*?-->", " ", text)
    # Hidden preheader blocks. Senders stash the inbox preview line (and stray
    # counters — the "96" at the top of an Indeed mail) in a display:none div
    # that no real mail client draws. Non-greedy to the matching close tag,
    # which handles the flat markup preheaders actually use; a nested hidden
    # element would leave its tail behind, and that is an acceptable miss.
    text = re.sub(
        r"(?is)<(div|span|td|p)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden"
        r"|mso-hide\s*:\s*all|font-size\s*:\s*0|max-height\s*:\s*0)[^>]*>.*?</\1\s*>",
        " ",
        text,
    )
    # Preserve the document's line structure before tags disappear.
    text = re.sub(rf"(?i)<\s*(?:{_BLOCK_TAGS})\b[^>]*>", "\n", text)
    text = re.sub(rf"(?i)</\s*(?:{_BLOCK_TAGS})\s*>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)

    text = unescape(text)
    text = _strip_invisibles(text)

    # Tidy the whitespace the tag-stripping leaves behind.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean_plain_text(text: str) -> str:
    """text/parts get the same invisible-character treatment — senders pad the
    plain-text alternative too."""
    text = _strip_invisibles(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _extract_body(payload: dict[str, Any]) -> str:
    """Best-effort plain-text body, walking the MIME tree.

    Prefers text/plain; falls back to a de-tagged text/html so an HTML-only
    email still shows something readable rather than blank.
    """
    if not payload:
        return ""

    stack = [payload]
    html_fallback = ""
    while stack:
        part = stack.pop()
        mime = part.get("mimeType", "")
        body = part.get("body", {}) or {}
        data = body.get("data", "")

        if mime == "text/plain" and data:
            return _clean_plain_text(_decode_part(data))
        if mime == "text/html" and data and not html_fallback:
            html_fallback = _decode_part(data)

        for child in part.get("parts", []) or []:
            stack.append(child)

    return _html_to_text(html_fallback) if html_fallback else ""


def _summarize(msg: dict[str, Any], *, include_body: bool = False) -> dict[str, Any]:
    payload = msg.get("payload", {}) or {}
    headers = payload.get("headers", []) or []
    label_ids = msg.get("labelIds", []) or []
    out: dict[str, Any] = {
        "id": msg.get("id", ""),
        "threadId": msg.get("threadId", ""),
        "from": _header(headers, "from"),
        "to": _header(headers, "to"),
        "subject": _header(headers, "subject") or "(no subject)",
        "date": _header(headers, "date"),
        "snippet": msg.get("snippet", ""),
        "unread": "UNREAD" in label_ids,
        "starred": "STARRED" in label_ids,
        "labelIds": label_ids,
    }
    if include_body:
        out["body"] = _extract_body(payload)
    return out


# --- Routes ----------------------------------------------------------------


@router.get("/status")
async def status() -> JSONResponse:
    """Whether Gmail is usable, reusing the shared Google connection."""
    configured = bool(gcal._client_id())
    connected = gcal.is_connected()
    has_gmail_scope = GMAIL_READ_SCOPE in gcal.granted_scopes()
    return JSONResponse(content={
        "configured": configured,
        "connected": connected,
        # A Google token from before Gmail scopes were added won't have inbox
        # access; the UI uses this to prompt a one-time reconnect.
        "gmailAuthorized": connected and has_gmail_scope,
        "canSend": connected and GMAIL_SEND_SCOPE in gcal.granted_scopes(),
    })


@router.get("/messages")
async def list_messages(q: str = "", label: str = "INBOX", maxResults: int = 15) -> JSONResponse:
    """List inbox messages (newest first), with headers and snippet."""
    params: dict[str, Any] = {"maxResults": max(1, min(50, maxResults))}
    if label:
        params["labelIds"] = label
    if q:
        params["q"] = q
    try:
        listing = await _api("GET", "/messages", params=params)
        ids = [m.get("id") for m in ((listing or {}).get("messages") or []) if m.get("id")]
        if not ids:
            return JSONResponse(content={"messages": []})

        async def fetch(mid: str) -> Optional[dict[str, Any]]:
            try:
                full = await _api(
                    "GET",
                    f"/messages/{mid}",
                    params={
                        "format": "metadata",
                        "metadataHeaders": ["From", "To", "Subject", "Date"],
                    },
                )
                return _summarize(full or {})
            except GmailError:
                return None

        import asyncio

        # gather preserves input order, keeping Gmail's newest-first listing.
        results = await asyncio.gather(*[fetch(mid) for mid in ids])
        messages = [r for r in results if r]
        return JSONResponse(content={"messages": messages})
    except GmailError as err:
        return _error(err)


@router.get("/messages/{message_id}")
async def get_message(message_id: str) -> JSONResponse:
    """Full message including decoded body."""
    try:
        full = await _api("GET", f"/messages/{message_id}", params={"format": "full"})
        return JSONResponse(content={"message": _summarize(full or {}, include_body=True)})
    except GmailError as err:
        return _error(err)


@router.post("/send")
async def send_message(request: Request) -> JSONResponse:
    """Send a plain-text email as the connected user."""
    body = await request.json()
    to = (body.get("to") or "").strip()
    subject = (body.get("subject") or "").strip()
    text = body.get("body") or ""

    if not to or "@" not in parseaddr(to)[1]:
        return _error(GmailError(400, "Enter a valid recipient email address."))

    mime = MIMEText(text, "plain", "utf-8")
    mime["To"] = to
    mime["Subject"] = subject
    if body.get("cc"):
        mime["Cc"] = body["cc"]
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")

    try:
        sent = await _api("POST", "/messages/send", json_body={"raw": raw})
        return JSONResponse(content={"ok": True, "id": (sent or {}).get("id", "")})
    except GmailError as err:
        return _error(err)


@router.post("/messages/{message_id}/modify")
async def modify_message(message_id: str, request: Request) -> JSONResponse:
    """Mark read/unread, star/unstar, or archive."""
    body = await request.json()
    action = (body.get("action") or "").strip()
    label_map = {
        "read": {"removeLabelIds": ["UNREAD"]},
        "unread": {"addLabelIds": ["UNREAD"]},
        "star": {"addLabelIds": ["STARRED"]},
        "unstar": {"removeLabelIds": ["STARRED"]},
        "archive": {"removeLabelIds": ["INBOX"]},
    }
    if action not in label_map:
        return _error(GmailError(400, "Unknown action. Use read, unread, star, unstar or archive."))
    try:
        updated = await _api("POST", f"/messages/{message_id}/modify", json_body=label_map[action])
        return JSONResponse(content={"ok": True, "message": _summarize(updated or {})})
    except GmailError as err:
        return _error(err)


@router.delete("/messages/{message_id}")
async def trash_message(message_id: str) -> JSONResponse:
    """Move a message to Trash (recoverable, unlike permanent delete)."""
    try:
        await _api("POST", f"/messages/{message_id}/trash")
        return JSONResponse(content={"ok": True})
    except GmailError as err:
        return _error(err)


# --- Assistant context -----------------------------------------------------


async def cached_unread(limit: int = 5) -> list[dict[str, Any]]:
    """A few unread subjects for Daisy's system prompt. Never raises."""
    try:
        listing = await _api("GET", "/messages", params={"maxResults": limit, "labelIds": "UNREAD"})
    except Exception:  # noqa: BLE001
        return []
    ids = [m.get("id") for m in ((listing or {}).get("messages") or []) if m.get("id")]
    out: list[dict[str, Any]] = []
    for mid in ids[:limit]:
        try:
            full = await _api(
                "GET",
                f"/messages/{mid}",
                params={"format": "metadata", "metadataHeaders": ["From", "Subject"]},
            )
            out.append(_summarize(full or {}))
        except Exception:  # noqa: BLE001
            continue
    return out
