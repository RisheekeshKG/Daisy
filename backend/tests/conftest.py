"""Shared pytest fixtures for the Daisy backend.

Sets DAISY_DATA_DIR to a throwaway temp directory *before* main/gcal/spotify
are imported anywhere in the test session — those modules compute their
token file paths at import time, so doing this later would let a test run
read or write the real user's OAuth tokens.
"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_tmp_data_dir = tempfile.mkdtemp(prefix="daisy-test-")
os.environ.setdefault("DAISY_DATA_DIR", _tmp_data_dir)
# No Gemini key in CI/tests: /api/daisy must exercise the local rule-based
# fallback rather than trying (and failing) to reach the real API.
os.environ.pop("GEMINI_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


@pytest.fixture(autouse=True)
def _no_real_gemini_key(monkeypatch):
    # main.py reloads the project's real .env at import time (override=True),
    # so a developer's actual GEMINI_API_KEY is already in main.GEMINI_API_KEY
    # by the time tests run. Force it off so /api/daisy exercises the local
    # fallback deterministically instead of making a real network call with
    # whoever's key happens to be configured on this machine.
    monkeypatch.setattr(main, "GEMINI_API_KEY", "")
    monkeypatch.setattr(main, "_gemini_client", None)


@pytest.fixture()
def client() -> TestClient:
    # base_url drives the Host header. TestClient's default ("testserver") is
    # rejected by main's local-only guard, exactly as any non-loopback host
    # would be, so tests address the app the way the real app does.
    return TestClient(main.app, base_url="http://127.0.0.1:8000")
