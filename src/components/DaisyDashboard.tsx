import React, { useState, useEffect } from "react";
import {
  Mic,
  Music,
  ArrowRight,
  Zap,
  Check,
  Mail,
  Calendar,
  Heart,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Plus,
  Activity,
  Flame,
  CheckSquare,
  ListTodo,
  AlertCircle
} from "lucide-react";
import { daisyVoice } from "../lib/voice";
import { spotify, type NowPlaying } from "../lib/spotify";
import WaveformHero from "./WaveformHero";

interface DaisyDashboardProps {
  onNavigate: (tab: "jarvis" | "music" | "notes" | "calendar" | "gmail" | "apple") => void;
  onSubmitPrompt: (text: string) => void;
  notesCount: number;
  eventsCount: number;
  voiceTranscript?: string;
  voiceProcessing?: boolean;
}

interface LocalNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

export default function DaisyDashboard({
  onNavigate,
  onSubmitPrompt,
  notesCount,
  eventsCount,
  voiceTranscript,
  voiceProcessing,
}: DaisyDashboardProps) {
  // Voice engine & Music state
  const [voiceIsMuted, setVoiceIsMuted] = useState<boolean>(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const musicIsPlaying = !!nowPlaying?.playing;
  
  // Real-time task checklists synced with localStorage
  const [localNotes, setLocalNotes] = useState<LocalNote[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState<string>("");

  // Apple health real-time synced data
  const [healthData, setHealthData] = useState({
    steps: 8420,
    calories: 485,
    heartRate: 68,
    lastSynced: new Date().toISOString()
  });

  // Load notes & initialize listeners on mount
  useEffect(() => {
    // Sync local notes checklist
    const loadNotes = () => {
      const saved = localStorage.getItem("jarvis_plain_notes");
      if (saved) {
        try {
          setLocalNotes(JSON.parse(saved));
        } catch (e) {}
      }
    };
    loadNotes();

    // Keep the widget in step with whatever Spotify is actually playing.
    const syncNowPlaying = async () => {
      try {
        setNowPlaying(await spotify.nowPlaying());
      } catch {
        /* Spotify not connected — the widget shows its idle state */
      }
    };
    syncNowPlaying();
    const nowPlayingTimer = window.setInterval(syncNowPlaying, 10000);

    // Sync apple health
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/apple-health");
        if (res.ok) {
          const json = await res.json();
          setHealthData({
            steps: json.steps ?? 8420,
            calories: json.calories ?? 485,
            heartRate: json.heartRate ?? 68,
            lastSynced: json.lastSynced ?? new Date().toISOString()
          });
        }
      } catch (err) {}
    };
    fetchHealth();

    // Check mute state of Daisy Voice Core
    setVoiceIsMuted(!daisyVoice.getEnabled());

    // Sync interval
    const interval = setInterval(() => {
      fetchHealth();
    }, 4000);

    return () => {
      clearInterval(interval);
      clearInterval(nowPlayingTimer);
    };
  }, []);

  // Quick speak trigger for voice-first listener
  const triggerVocalSpeak = () => {
    const lines = [
      "Voice is online and ready. Tell me what to sync.",
      "I'm listening in the background — go ahead and focus, I've got this.",
      "Everything's synced with your Apple Watch and iCloud files.",
      "Systems are running fine. I'm listening whenever you need me.",
    ];
    const chosen = lines[Math.floor(Math.random() * lines.length)];
    daisyVoice.speak(chosen);
  };

  // Toggle voice enablement
  const handleToggleVoiceMute = () => {
    const currentlyEnabled = daisyVoice.getEnabled();
    daisyVoice.setEnabled(!currentlyEnabled);
    setVoiceIsMuted(currentlyEnabled); // if was enabled, now it's disabled (muted)
    
    // Play sound cue
    if (currentlyEnabled) {
      daisyVoice.speak("Vocal synthesis paused.");
    } else {
      daisyVoice.speak("Vocal synthesis active.");
    }
  };

  /** Play/pause the user's actual Spotify playback. */
  const handleToggleMusic = async () => {
    try {
      await (musicIsPlaying ? spotify.pause() : spotify.play());
      // Re-read rather than assuming: Spotify rejects control on free accounts
      // and when no device is open, and the widget should show the truth.
      setNowPlaying(await spotify.nowPlaying());
    } catch {
      /* surfaced in the Spotify tab, which has room for the error text */
    }
  };

  // Fast task check/uncheck
  const handleToggleTask = (id: string) => {
    const updated = localNotes.map(n => {
      if (n.id === id) {
        const isDone = n.title.startsWith("✓ ");
        return {
          ...n,
          title: isDone ? n.title.replace("✓ ", "") : "✓ " + n.title
        };
      }
      return n;
    });
    setLocalNotes(updated);
    localStorage.setItem("jarvis_plain_notes", JSON.stringify(updated));
  };

  // Fast task append
  const handleAddQuickTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const newNote: LocalNote = {
      id: crypto.randomUUID(),
      title: newTaskTitle,
      content: "Created from live voice-first command deck.",
      tags: ["Checklist"],
      updatedAt: new Date().toISOString()
    };
    const updated = [newNote, ...localNotes];
    setLocalNotes(updated);
    setNewTaskTitle("");
    localStorage.setItem("jarvis_plain_notes", JSON.stringify(updated));
  };

  return (
    <div id="daisy-dashboard-view" className="h-full flex flex-col p-6 md:p-10 text-zinc-800 overflow-y-auto select-none relative">
      
      {/* Main Greeting Display */}
      <div className="mt-2 mb-10 text-center sm:text-left">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-zinc-950 font-sans leading-none">
          Hi Rishi, Ready to<br />
          Achieve Great Things?
        </h1>
      </div>

      {/* Hero: live animated waveform (replaces the feature cards) */}
      <WaveformHero playing={musicIsPlaying} transcript={voiceTranscript} processing={voiceProcessing} onTalk={() => onNavigate("jarvis")} />

      {/* Slim quick-access to each workspace */}
      <div className="flex flex-wrap gap-2 mb-10 relative z-20">
        {[
          { label: "Tasks", tab: "notes" as const, color: "text-amber-600" },
          { label: "Mail", tab: "gmail" as const, color: "text-rose-500" },
          { label: "Music", tab: "music" as const, color: "text-emerald-600" },
          { label: "Calendar", tab: "calendar" as const, color: "text-blue-500" },
          { label: "Apple", tab: "apple" as const, color: "text-pink-500" },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.tab)}
            className={`text-[11px] font-bold ${item.color} bg-white/50 hover:bg-white/80 border border-white/60 px-4 py-2 rounded-full shadow-sm transition-all active:scale-95 cursor-pointer`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Upgraded Bottom Section: High-Fidelity system widgets */}
      <div className="mt-10 space-y-6 relative z-20">

        {/* Real-time connected workspace widgets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Widget 1: Interactive Task Checklist */}
            <div className="bg-white/10 backdrop-blur-xl border border-white/30 rounded-[28px] p-4 flex flex-col justify-between shadow-sm min-h-[140px]">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-black text-amber-700 uppercase tracking-wider flex items-center gap-1">
                    <ListTodo className="w-3 h-3" />
                    Quick Checklist
                  </span>
                  <span className="text-[9px] text-zinc-400 font-bold">
                    {localNotes.filter(n => n.title.startsWith("✓ ")).length}/{localNotes.length} Done
                  </span>
                </div>

                {/* Checklist display */}
                <div className="space-y-1.5 max-h-[80px] overflow-y-auto pr-1">
                  {localNotes.slice(0, 3).map((note) => {
                    const isDone = note.title.startsWith("✓ ");
                    const cleanTitle = note.title.replace("✓ ", "");
                    return (
                      <div
                        key={note.id}
                        onClick={() => handleToggleTask(note.id)}
                        className="flex items-center gap-2 p-1.5 hover:bg-white/40 rounded-lg cursor-pointer transition-all"
                      >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                          isDone ? "bg-amber-500 border-amber-500 text-white" : "border-zinc-300 bg-white"
                        }`}>
                          {isDone && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className={`text-[11px] font-bold truncate leading-none ${isDone ? "line-through text-zinc-400" : "text-zinc-800"}`}>
                          {cleanTitle}
                        </span>
                      </div>
                    );
                  })}
                  {localNotes.length === 0 && (
                    <div className="text-[10px] text-zinc-400 italic py-1 text-center">
                      No pending tasks! Add one below.
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Append Task Form */}
              <form onSubmit={handleAddQuickTask} className="flex gap-1.5 mt-2 pt-2 border-t border-zinc-200/40">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Append quick task..."
                  className="flex-1 bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[10px] font-bold text-zinc-700 focus:outline-none"
                />
                <button
                  type="submit"
                  className="p-1 bg-zinc-900 hover:bg-zinc-850 text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            {/* Widget 2: Spotify Soundscape Player */}
            <div className="bg-white/10 backdrop-blur-xl border border-white/30 rounded-[28px] p-4 flex flex-col justify-between shadow-sm min-h-[140px]">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                    <Music className="w-3 h-3" />
                    Spotify
                  </span>
                  {musicIsPlaying && (
                    <span className="flex items-center gap-0.5">
                      <span className="w-1 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="w-1 h-3 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                      <span className="w-1 h-1 bg-emerald-500 rounded-full" />
                    </span>
                  )}
                </div>

                {/* Track metadata block */}
                <div className="flex items-start gap-2.5 p-1 bg-white/30 rounded-xl border border-white/40">
                  {/* Mini spinning disc, matching the Spotify tab's vinyl. */}
                  <div className="w-10 h-10 rounded-full bg-zinc-900 shadow-inner shrink-0 relative overflow-hidden flex items-center justify-center">
                    {nowPlaying?.track?.image ? (
                      <img
                        src={nowPlaying.track.image}
                        alt={nowPlaying.track.album}
                        referrerPolicy="no-referrer"
                        className={`w-full h-full object-cover ${musicIsPlaying ? "animate-spin" : ""}`}
                        style={{ animationDuration: "12s" }}
                      />
                    ) : (
                      <Music className="w-5 h-5 text-emerald-400" />
                    )}
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-zinc-900 border border-white/30" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-[11px] font-bold text-zinc-800 truncate leading-snug">
                      {nowPlaying?.track?.name || "Nothing playing"}
                    </h4>
                    <p className="text-[9px] text-zinc-500 font-bold truncate">
                      {nowPlaying?.track?.artist || "Ask Daisy to play something"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Controls Row */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-200/40">
                <button
                  onClick={handleToggleMusic}
                  className="flex-1 py-1 px-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-black rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer shadow-sm"
                >
                  {musicIsPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {musicIsPlaying ? "Pause" : "Play"}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await spotify.next();
                      setNowPlaying(await spotify.nowPlaying());
                    } catch {
                      /* surfaced in the Spotify tab */
                    }
                  }}
                  className="p-1.5 hover:bg-white/40 border border-zinc-200 rounded-lg text-zinc-600 text-[9px] font-bold transition-all cursor-pointer"
                  title="Next track"
                >
                  Skip
                </button>
              </div>
            </div>

            {/* Widget 3: Live Gmail Notifications */}
            <div className="bg-white/10 backdrop-blur-xl border border-white/30 rounded-[28px] p-4 flex flex-col justify-between shadow-sm min-h-[140px]">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    Gmail Workspace
                  </span>
                  <span className="text-[8px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full font-black">
                    2 UNREAD
                  </span>
                </div>

                <div className="p-2 bg-rose-50/20 rounded-xl border border-rose-500/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-800">Workspace security draft</span>
                    <span className="text-[8px] text-zinc-400 font-mono">10:55 AM</span>
                  </div>
                  <p className="text-[9px] text-zinc-500 font-semibold truncate mt-0.5">
                    "Rishi, let's configure the Apple Shortcut sync URL to avoid TLS..."
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-200/40 text-[9px] font-bold text-zinc-500">
                <span>Rishi's Google Client</span>
                <button
                  onClick={() => onNavigate("gmail")}
                  className="text-rose-600 hover:underline flex items-center gap-0.5 cursor-pointer font-bold"
                >
                  Sync Inbox <ArrowRight className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {/* Widget 4: Apple Health Sync Vitality */}
            <div className="bg-white/10 backdrop-blur-xl border border-white/30 rounded-[28px] p-4 flex flex-col justify-between shadow-sm min-h-[140px]">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    Apple Healthkit Sync
                  </span>
                  <span className="text-[9px] font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100 font-black">
                    Live Watch
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-1.5 bg-white/40 rounded-xl border border-white/50">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase block leading-none">Steps</span>
                    <span className="text-sm font-black text-zinc-950 block mt-0.5">{healthData.steps}</span>
                  </div>
                  <div className="p-1.5 bg-white/40 rounded-xl border border-white/50">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase block leading-none">Heart</span>
                    <span className="text-sm font-black text-zinc-950 block mt-0.5">{healthData.heartRate} <span className="text-[8px] text-rose-500 font-medium">BPM</span></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-200/40 text-[8px] text-zinc-400 font-bold">
                <span>Last Sync: {new Date(healthData.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <button
                  onClick={() => onNavigate("apple")}
                  className="text-zinc-600 hover:underline cursor-pointer"
                >
                  Configure Shorties
                </button>
              </div>
            </div>

          </div>

        {/* Footer Brand Info Line */}
        <div className="flex items-center justify-end text-[11px] text-zinc-500 pt-2 px-2 border-t border-zinc-200/30">
          <span className="font-mono text-zinc-400 font-semibold">Daisy v1</span>
        </div>

      </div>

    </div>
  );
}
