"""Status endpoints must never throw, even fully unconfigured (no client id,
no token on disk) — the frontend polls them on every load to decide whether
to show a "connect" prompt, so a 500 here would break every workspace tab.
"""
import os

import pytest


@pytest.fixture(autouse=True)
def _unconfigured(monkeypatch):
    for var in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SPOTIFY_CLIENT_ID"):
        monkeypatch.delenv(var, raising=False)


def test_gcal_status_unconfigured(client):
    res = client.get("/api/gcal/status")
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["connected"] is False


def test_gmail_status_unconfigured(client):
    res = client.get("/api/gmail/status")
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["connected"] is False


def test_spotify_status_unconfigured(client):
    res = client.get("/api/spotify/status")
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["connected"] is False


def test_spotify_login_without_client_id_is_a_clean_400(client):
    res = client.get("/api/spotify/login")
    assert res.status_code == 400
    assert "SPOTIFY_CLIENT_ID" in res.json()["error"]


def test_spotify_direct_song_query_uses_track_resolution(monkeypatch):
    # A song title should resolve to a track instead of a playlist whose name is
    # only loosely similar.
    async def fake_api(method, path, **kwargs):
        if path == "/search":
            return {
                "tracks": {
                    "items": [{
                        "name": "Yellow",
                        "uri": "spotify:track:yellow",
                        "artists": [{"name": "Coldplay"}],
                    }]
                },
                "playlists": {
                    "items": [{
                        "name": "Yellow Playlist",
                        "uri": "spotify:playlist:yellowplaylist",
                    }]
                },
            }
        raise AssertionError(f"unexpected api call: {path}")

    import spotify

    async def fake_start_playback(**kwargs):
        return None

    monkeypatch.setattr(spotify, "_api", fake_api)
    monkeypatch.setattr(spotify, "_start_playback", fake_start_playback)

    result = __import__("asyncio").run(spotify.resolve_and_play("play yellow"))

    assert result["kind"] == "track"
    assert result["name"] == "Yellow"
    assert result["uri"] == "spotify:track:yellow"
