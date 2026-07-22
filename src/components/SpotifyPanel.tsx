import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, SkipForward, SkipBack, Shuffle, Volume2, ListMusic,
  RefreshCw, LogOut, AlertCircle, Laptop, Smartphone, Speaker, Loader2, Link2,
} from "lucide-react";
import { motion } from "motion/react";
import {
  spotify, SpotifyRequestError,
  type SpotifyStatus, type SpotifyPlaylist, type SpotifyDevice, type NowPlaying,
} from "../lib/spotify";

/** How often to refresh the now-playing bar while connected. */
const POLL_MS = 5000;

/** mm:ss for a track position/duration. */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Spinning vinyl for the current Spotify track. Rotation is tied to real
 * playback state, so the disc stops the moment playback pauses.
 */
function VinylDisc({ image, alt, playing }: { image: string | null; alt: string; playing: boolean }) {
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <div className="absolute inset-0 bg-gradient-to-tr from-emerald-300/30 to-amber-400/30 rounded-full blur-lg" />
      {image ? (
        <motion.img
          src={image}
          alt={alt}
          referrerPolicy="no-referrer"
          animate={playing ? { rotate: 360 } : { rotate: 0 }}
          transition={
            playing
              ? { repeat: Infinity, duration: 18, ease: "linear" }
              : { duration: 0.4 }
          }
          className="w-full h-full object-cover rounded-full border-4 border-zinc-900 shadow-xl relative z-10"
        />
      ) : (
        <div className="w-full h-full rounded-full border-4 border-zinc-900 bg-zinc-100 flex items-center justify-center text-zinc-300 relative z-10">
          <ListMusic className="w-6 h-6" />
        </div>
      )}
      {/* Vinyl center pinhole */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-zinc-900 border border-white/20 z-20 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}

function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const t = (type || "").toLowerCase();
  if (t === "smartphone") return <Smartphone className={className} />;
  if (t === "computer") return <Laptop className={className} />;
  return <Speaker className={className} />;
}

export default function SpotifyPanel() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [search, setSearch] = useState("");
  const pollRef = useRef<number | undefined>(undefined);
  // Playback position advanced locally between polls, so the progress bar moves
  // smoothly instead of jumping once every POLL_MS.
  const [displayProgressMs, setDisplayProgressMs] = useState(0);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await spotify.status();
      setStatus(s);
      return s;
    } catch {
      setStatus({ configured: false, connected: false, redirectUri: "" });
      return null;
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const [pl, dv] = await Promise.all([spotify.playlists(), spotify.devices()]);
      setPlaylists(pl);
      setDevices(dv);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your Spotify library.");
    }
  }, []);

  const pollNowPlaying = useCallback(async () => {
    try {
      setNowPlaying(await spotify.nowPlaying());
    } catch {
      /* transient — keep showing the last known state */
    }
  }, []);

  useEffect(() => {
    refreshStatus().then((s) => {
      if (s?.connected) {
        loadLibrary();
        pollNowPlaying();
      }
    });
  }, [refreshStatus, loadLibrary, pollNowPlaying]);

  // Keep the now-playing bar live while connected.
  useEffect(() => {
    if (!status?.connected) return;
    pollRef.current = window.setInterval(pollNowPlaying, POLL_MS);
    return () => window.clearInterval(pollRef.current);
  }, [status?.connected, pollNowPlaying]);

  // Re-sync the local position whenever Spotify tells us where it actually is,
  // including on track change (where progress resets to ~0).
  useEffect(() => {
    setDisplayProgressMs(nowPlaying?.progressMs ?? 0);
  }, [nowPlaying?.progressMs, nowPlaying?.track?.id]);

  // Advance it once a second while playing; the next poll corrects any drift.
  useEffect(() => {
    if (!nowPlaying?.playing) return;
    const duration = nowPlaying.track?.durationMs;
    const id = window.setInterval(() => {
      setDisplayProgressMs((p) => (duration ? Math.min(p + 1000, duration) : p + 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [nowPlaying?.playing, nowPlaying?.track?.id, nowPlaying?.track?.durationMs]);

  /** Run a playback action, surfacing Spotify's error text and refreshing state. */
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      // Spotify's state lags the command by a beat.
      setTimeout(pollNowPlaying, 400);
    } catch (err) {
      setError(
        err instanceof SpotifyRequestError ? err.message : "That didn't work. Try again."
      );
    } finally {
      setBusy("");
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError("");
    try {
      await spotify.beginLogin();
      // The consent screen lives in the user's browser; poll until the backend
      // reports a completed handshake (or the user gives up).
      const started = Date.now();
      const tick = window.setInterval(async () => {
        const s = await refreshStatus();
        if (s?.connected) {
          window.clearInterval(tick);
          setConnecting(false);
          loadLibrary();
          pollNowPlaying();
        } else if (Date.now() - started > 180000) {
          window.clearInterval(tick);
          setConnecting(false);
        }
      }, 2000);
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : "Could not start Spotify sign-in.");
    }
  };

  const handleDisconnect = async () => {
    await spotify.logout();
    setPlaylists([]);
    setDevices([]);
    setNowPlaying(null);
    refreshStatus();
  };

  // --- Setup / connect states ---------------------------------------------

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="bg-white/40 border border-white/50 rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600">
            <ListMusic className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-extrabold text-zinc-800">Connect Spotify</h3>
        </div>
        <p className="text-xs text-zinc-600 leading-relaxed mb-3">
          Daisy can play your real Spotify playlists, but it needs a free Spotify app
          registration first (one-time setup):
        </p>
        <ol className="text-xs text-zinc-600 leading-relaxed space-y-1.5 list-decimal pl-4 mb-3">
          <li>
            Open{" "}
            <span className="font-mono bg-zinc-100 px-1 py-0.5 rounded">
              developer.spotify.com/dashboard
            </span>{" "}
            and click <strong>Create app</strong>.
          </li>
          <li>Name it anything, tick <strong>Web API</strong>.</li>
          <li>
            Set the Redirect URI to exactly:
            <span className="block font-mono bg-zinc-100 px-2 py-1 rounded mt-1 break-all">
              {status.redirectUri || "http://127.0.0.1:8000/api/spotify/callback"}
            </span>
          </li>
          <li>
            Copy the <strong>Client ID</strong> into your{" "}
            <span className="font-mono bg-zinc-100 px-1 py-0.5 rounded">.env</span> as{" "}
            <span className="font-mono bg-zinc-100 px-1 py-0.5 rounded">SPOTIFY_CLIENT_ID</span>,
            then restart Daisy.
          </li>
        </ol>
        <button
          onClick={() => refreshStatus()}
          className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Check again
        </button>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="bg-white/40 border border-white/50 rounded-3xl p-6 text-center">
        <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-600 mb-3">
          <ListMusic className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-extrabold text-zinc-800 mb-1">Connect your Spotify</h3>
        <p className="text-xs text-zinc-600 mb-4 max-w-sm mx-auto leading-relaxed">
          Sign in to let Daisy play your playlists. The consent page opens in your browser.
        </p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-bold rounded-full shadow-sm transition-all cursor-pointer"
        >
          {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {connecting ? "Waiting for Spotify…" : "Connect Spotify"}
        </button>
        {connecting && (
          <p className="text-[11px] text-zinc-500 mt-3">
            Finish signing in in your browser — this updates automatically.
          </p>
        )}
        {error && <p className="text-[11px] text-rose-600 mt-3">{error}</p>}
      </div>
    );
  }

  // --- Connected -----------------------------------------------------------

  const isFree = status.user?.product && status.user.product !== "premium";
  const visiblePlaylists = search.trim()
    ? playlists.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : playlists;
  const track = nowPlaying?.track;
  const trackProgressPct = track?.durationMs
    ? Math.min(100, (displayProgressMs / track.durationMs) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Account bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-bold text-zinc-700">{status.user?.name || "Spotify"}</span>
          <span className="text-zinc-400 capitalize">{status.user?.product}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { loadLibrary(); pollNowPlaying(); }}
            className="flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-zinc-700 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-rose-600 cursor-pointer"
          >
            <LogOut className="w-3 h-3" /> Disconnect
          </button>
        </div>
      </div>

      {isFree && (
        <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Spotify only allows apps to control playback on Premium accounts, so play and
            skip will be rejected. Browsing your playlists still works.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-2xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Now playing + transport */}
      <div className="bg-white/50 border border-white/60 rounded-3xl p-4 flex items-center gap-4 flex-wrap">
        <VinylDisc
          image={track?.image ?? null}
          alt={track?.album || "Album art"}
          playing={!!nowPlaying?.playing}
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-zinc-800 truncate">
            {track?.name || "Nothing playing"}
          </p>
          <p className="text-[11px] text-zinc-500 truncate">
            {track ? track.artist : "Start a playlist below, or ask Daisy out loud."}
          </p>
          {track && (
            <div className="mt-1.5">
              <div className="h-1 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-[width] duration-1000 ease-linear"
                  style={{ width: `${trackProgressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-zinc-400 font-mono font-bold mt-0.5">
                <span>{formatTime(displayProgressMs)}</span>
                <span>{formatTime(track.durationMs)}</span>
              </div>
            </div>
          )}
          {nowPlaying?.device && (
            <p className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
              <DeviceIcon type={nowPlaying.device.type} className="w-3 h-3" />
              {nowPlaying.device.name}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => act("prev", () => spotify.previous())}
            disabled={!!busy}
            className="p-2 rounded-full hover:bg-zinc-100 text-zinc-600 disabled:opacity-40 cursor-pointer transition-all"
            title="Previous"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              nowPlaying?.playing
                ? act("pause", () => spotify.pause())
                : act("play", () => spotify.play())
            }
            disabled={!!busy}
            className="p-3 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm disabled:opacity-40 cursor-pointer transition-all"
            title={nowPlaying?.playing ? "Pause" : "Play"}
          >
            {busy === "play" || busy === "pause" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : nowPlaying?.playing ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => act("next", () => spotify.next())}
            disabled={!!busy}
            className="p-2 rounded-full hover:bg-zinc-100 text-zinc-600 disabled:opacity-40 cursor-pointer transition-all"
            title="Next"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            onClick={() => act("shuffle", () => spotify.setShuffle(!nowPlaying?.shuffle))}
            disabled={!!busy}
            className={`p-2 rounded-full hover:bg-zinc-100 disabled:opacity-40 cursor-pointer transition-all ${
              nowPlaying?.shuffle ? "text-emerald-600" : "text-zinc-500"
            }`}
            title="Shuffle"
          >
            <Shuffle className="w-4 h-4" />
          </button>
        </div>

        {nowPlaying?.device?.volumePercent != null && (
          <div className="flex items-center gap-2 w-full sm:w-36">
            <Volume2 className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={nowPlaying.device.volumePercent}
              onMouseUp={(e) => act("vol", () => spotify.setVolume(Number(e.currentTarget.value)))}
              onTouchEnd={(e) => act("vol", () => spotify.setVolume(Number(e.currentTarget.value)))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Devices */}
      {devices.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-zinc-500">Play on:</span>
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => act(`dev-${d.id}`, () => spotify.transfer(d.id, !!nowPlaying?.playing))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
                d.is_active
                  ? "bg-emerald-500 border-emerald-600 text-white"
                  : "bg-white/60 border-zinc-200 text-zinc-600 hover:bg-white"
              }`}
            >
              <DeviceIcon type={d.type} className="w-3 h-3" />
              {d.name}
            </button>
          ))}
        </div>
      )}

      {devices.length === 0 && (
        <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-2xl px-3 py-2">
          No Spotify device is open right now. Launch Spotify on your Mac or phone and it
          will show up here — Daisy plays through it.
        </p>
      )}

      {/* Playlists */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-extrabold text-zinc-700 flex items-center gap-1.5">
          <ListMusic className="w-3.5 h-3.5" /> Your playlists ({playlists.length})
        </h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter playlists…"
          className="bg-zinc-50 border border-zinc-200 rounded-full px-3 py-1 text-[11px] w-40 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visiblePlaylists.map((p) => (
          <button
            key={p.id}
            onClick={() => act(`pl-${p.id}`, () => spotify.play({ contextUri: p.uri }))}
            disabled={!!busy}
            className="group text-left bg-white/50 hover:bg-white border border-white/60 hover:border-emerald-200 rounded-2xl p-2.5 transition-all disabled:opacity-50 cursor-pointer"
          >
            <div className="relative mb-2">
              {p.image ? (
                <img
                  src={p.image}
                  alt={p.name}
                  referrerPolicy="no-referrer"
                  className="w-full aspect-square object-cover rounded-xl shadow-sm"
                />
              ) : (
                <div className="w-full aspect-square rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-300">
                  <ListMusic className="w-7 h-7" />
                </div>
              )}
              <span className="absolute bottom-1.5 right-1.5 p-1.5 rounded-full bg-emerald-500 text-white opacity-0 group-hover:opacity-100 shadow transition-all">
                {busy === `pl-${p.id}` ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
              </span>
            </div>
            <p className="text-[11px] font-bold text-zinc-800 truncate">{p.name}</p>
            <p className="text-[10px] text-zinc-500 truncate">{p.trackCount} tracks</p>
          </button>
        ))}
      </div>

      {playlists.length === 0 && !error && (
        <p className="text-[11px] text-zinc-500 text-center py-6">
          No playlists found on your account yet.
        </p>
      )}
    </div>
  );
}
