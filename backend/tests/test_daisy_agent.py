"""No GEMINI_API_KEY is set in tests (see conftest), so /api/daisy always
exercises the local rule-based fallback — this is deliberate: it lets these
tests run offline and deterministically, without a real API key or network
access.
"""
import asyncio

import main


def test_daisy_falls_back_without_gemini_key(client):
    res = client.post("/api/daisy", json={"message": "hello", "history": [], "context": {}})
    assert res.status_code == 200
    body = res.json()
    assert "text" in body
    assert isinstance(body.get("commands"), list)


def test_fallback_replies_never_ask_to_keep_listening(client):
    # The offline fallback never asks a follow-up question, so the wake word
    # should always be required again afterward — see simulated_response().
    for message in ("hello", "schedule a meeting", "write a note", "play some jazz"):
        res = client.post("/api/daisy", json={"message": message, "history": [], "context": {}})
        assert res.json()["listenAfter"] is False, message


def test_daisy_fallback_schedules_event_on_calendar_keywords(client):
    res = client.post(
        "/api/daisy",
        json={"message": "please schedule a meeting", "history": [], "context": {}},
    )
    body = res.json()
    assert any(c.get("type") == "ADD_EVENT" for c in body["commands"])


def test_daisy_fallback_adds_note_on_note_keywords(client):
    res = client.post(
        "/api/daisy",
        json={"message": "write a note about this", "history": [], "context": {}},
    )
    body = res.json()
    assert any(c.get("type") == "ADD_NOTE" for c in body["commands"])


def test_system_prompt_uses_provided_user_name():
    prompt = asyncio.run(main.build_system_instruction({"userName": "Alex"}))
    assert "The user's name is Alex." in prompt


def test_system_prompt_has_no_hardcoded_name():
    prompt = asyncio.run(main.build_system_instruction({}))
    assert "Rishi" not in prompt


def test_adjudicated_request_stays_silent_when_gemini_is_unreachable(client):
    # With no API key the Gemini call fails. For an utterance the on-device
    # scorer couldn't place, falling back to the rule-based responder would
    # mean answering out loud something that may have been said to a friend —
    # so an unanswerable addressee question must resolve to silence.
    res = client.post(
        "/api/daisy",
        json={
            "message": "put that on",
            "history": [],
            "context": {},
            "adjudicateAddressee": True,
        },
    )
    body = res.json()
    assert body["notForMe"] is True
    assert body["text"] == ""
    assert body["commands"] == []


def test_unadjudicated_request_still_uses_the_local_fallback(client):
    # Without the flag, behaviour is unchanged: the caller already knows this
    # was meant for Daisy, so a Gemini outage should still get a spoken answer.
    res = client.post(
        "/api/daisy",
        json={"message": "play some jazz", "history": [], "context": {}},
    )
    body = res.json()
    assert "notForMe" not in body
    assert body["text"]


def test_addressee_adjudication_only_added_when_requested():
    base = asyncio.run(main.build_system_instruction({}))
    assert "ADDRESSEE CHECK" not in base
    assert "notForMe" in main.ADDRESSEE_ADJUDICATION


def test_system_prompt_documents_listen_after_contract():
    # The frontend re-arms the wake window purely off this field's presence in
    # the model's JSON reply — if the schema/guidance describing it ever gets
    # deleted from the prompt, the model stops emitting it and voice mode goes
    # back to requiring the wake word for every single follow-up. This is a
    # regression guard on the prompt text, not the model's actual behavior.
    prompt = asyncio.run(main.build_system_instruction({}))
    assert '"listenAfter"' in prompt
