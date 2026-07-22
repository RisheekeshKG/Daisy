import React from "react";
import { Radio } from "lucide-react";
import SpotifyPanel from "./SpotifyPanel";

/**
 * The Music tab. Daisy plays music through Spotify only — the now-playing disc,
 * transport controls and library all live in SpotifyPanel.
 */
export default function MediaSpotify() {
  return (
    <div
      id="media_spotify_view"
      className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto"
    >
      <div className="flex items-center gap-3 border-b border-zinc-200/60 pb-4 mb-4 flex-shrink-0">
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl relative text-emerald-600 shadow-sm">
          <Radio className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">Spotify</h1>
          <p className="text-xs text-zinc-500 font-medium">
            Your real playlists, played through Spotify
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <SpotifyPanel />
      </div>
    </div>
  );
}
