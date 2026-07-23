/**
 * Spotify client — thin wrapper over Daisy's backend /api/spotify/* routes.
 *
 * All OAuth and token handling lives in the backend (backend/spotify.py); the
 * frontend never sees an access token. Daisy controls playback on whichever
 * Spotify device is already running (desktop app, phone, speaker) via the
 * Spotify Connect API, so playback needs Premium and an open Spotify client.
 */

import { daisyBridge } from "./daisyBridge";

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  user?: { id: string; name: string; product: string };
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  owner: string | null;
  trackCount: number;
  image: string | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface NowPlaying {
  playing: boolean;
  progressMs?: number;
  shuffle?: boolean;
  track: {
    id: string;
    uri: string;
    name: string;
    artist: string;
    album: string;
    durationMs: number;
    image: string | null;
  } | null;
  device: { id: string; name: string; type: string; volumePercent: number | null } | null;
}

/** Error carrying the backend's human-readable message and HTTP status. */
export class SpotifyRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SpotifyRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/spotify${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new SpotifyRequestError(res.status, data?.error || `Spotify request failed (${res.status})`);
  }
  return data as T;
}

export const spotify = {
  status: () => request<SpotifyStatus>("/status"),
  playlists: () => request<{ playlists: SpotifyPlaylist[] }>("/playlists").then((r) => r.playlists),
  devices: () => request<{ devices: SpotifyDevice[] }>("/devices").then((r) => r.devices),
  nowPlaying: () => request<NowPlaying>("/now-playing"),

  play: (body: { contextUri?: string; uris?: string[]; deviceId?: string } = {}) =>
    request<{ ok: boolean }>("/play", { method: "PUT", body: JSON.stringify(body) }),
  /** Play by name — resolves against the user's playlists, then Spotify search. */
  playQuery: (query: string, deviceId?: string) =>
    request<{ ok: boolean; kind: string; name: string }>("/play-query", {
      method: "PUT",
      body: JSON.stringify({ query, deviceId }),
    }),
  pause: () => request<{ ok: boolean }>("/pause", { method: "PUT" }),
  next: () => request<{ ok: boolean }>("/next", { method: "POST" }),
  previous: () => request<{ ok: boolean }>("/previous", { method: "POST" }),
  setVolume: (percent: number) =>
    request<{ ok: boolean }>("/volume", { method: "PUT", body: JSON.stringify({ percent }) }),
  setShuffle: (state: boolean) =>
    request<{ ok: boolean }>("/shuffle", { method: "PUT", body: JSON.stringify({ state }) }),
  transfer: (deviceId: string, play = true) =>
    request<{ ok: boolean }>("/transfer", { method: "PUT", body: JSON.stringify({ deviceId, play }) }),
  /** Repeat mode: "off" | "context" (playlist/album) | "track". */
  setRepeat: (mode: "off" | "context" | "track") =>
    request<{ ok: boolean; mode: string }>("/repeat", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),

  /** Jump to an absolute position in the current track. */
  seek: (positionMs: number) =>
    request<{ ok: boolean; positionMs: number }>("/seek", {
      method: "PUT",
      body: JSON.stringify({ positionMs }),
    }),

  /** Move forward/back relative to the current position (negative rewinds). */
  seekBy: (relativeMs: number) =>
    request<{ ok: boolean; positionMs: number }>("/seek", {
      method: "PUT",
      body: JSON.stringify({ relativeMs }),
    }),

  /** Queue a song to play next, by name or URI. */
  queue: (query: string) =>
    request<{ ok: boolean; name: string | null }>("/queue", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),

  /** Like (or unlike) the track that's playing. Needs user-library-modify. */
  saveCurrent: (save = true) =>
    request<{ ok: boolean; saved: boolean }>("/save", {
      method: "PUT",
      body: JSON.stringify({ save }),
    }),

  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  /**
   * Kick off the OAuth consent flow. The consent page must open in a real
   * browser (Spotify blocks embedded webviews), so route it through Electron's
   * shell when available and fall back to a new tab in the browser build.
   */
  async beginLogin(): Promise<void> {
    const { url } = await request<{ url: string }>("/login");
    if (daisyBridge?.openExternal) {
      const opened = await daisyBridge.openExternal(url);
      if (opened) return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },
};
