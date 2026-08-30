"""The API fronts the user's mail, calendar and files with no user-level auth,
so its only boundary is "the caller is Daisy itself". These tests pin that
boundary: loopback is not a security boundary in a browser, because any page
the user visits can issue requests to 127.0.0.1.
"""
from fastapi.testclient import TestClient

import main


def _client(base_url: str = "http://127.0.0.1:8000") -> TestClient:
    return TestClient(main.app, base_url=base_url)


def test_cors_is_never_a_wildcard():
    # "*" with allow_credentials would let any site on the internet read the
    # user's mail. Regression guard for the original configuration.
    assert "*" not in main.ALLOWED_ORIGINS
    assert all(
        o.startswith("http://localhost") or o.startswith("http://127.0.0.1")
        for o in main.ALLOWED_ORIGINS
    )


def test_request_from_a_malicious_page_is_rejected():
    res = _client().get("/healthz", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert res.json()["error"] == "forbidden origin"


def test_state_changing_call_from_a_malicious_page_is_rejected():
    # The dangerous case: a cross-origin POST the browser would let through
    # (the attacker never needs to read the response for the send to happen).
    res = _client().post(
        "/api/daisy",
        json={"message": "hi"},
        headers={"Origin": "https://evil.example"},
    )
    assert res.status_code == 403


def test_dns_rebinding_is_rejected():
    # An attacker domain resolved to 127.0.0.1 is same-origin as far as the
    # browser is concerned, so Origin alone would not save us — but the Host
    # header still carries the attacker's domain.
    res = _client(base_url="http://evil.example:8000").get("/healthz")
    assert res.status_code == 403
    assert res.json()["error"] == "forbidden host"


def test_the_app_itself_is_allowed():
    for origin in sorted(main.ALLOWED_ORIGINS):
        res = _client().get("/healthz", headers={"Origin": origin})
        assert res.status_code == 200, origin


def test_same_origin_request_without_an_origin_header_is_allowed():
    assert _client().get("/healthz").status_code == 200


def test_loopback_hosts_are_allowed():
    for base in ("http://127.0.0.1:8000", "http://localhost:8000"):
        assert _client(base_url=base).get("/healthz").status_code == 200
