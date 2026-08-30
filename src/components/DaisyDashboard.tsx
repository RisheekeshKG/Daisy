import React, { useState, useEffect, useMemo } from "react";
import { Card, CardBadge, CardTitle, CardBody, CardAction } from "./Card";
import { CACHE_KEYS, readCache } from "../lib/cache";
import type { GmailStatus } from "../lib/gmail";
import type { GmailMessage } from "../types";
import {
  Mic,
  Music,
  ArrowRight,
  Zap,
  Check,
  Mail,
  Calendar,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Plus,
  CheckSquare,
  ListTodo,
  AlertCircle,
  Sparkles,
  NotebookPen,
  CalendarDays,
  ArrowUpRight
} from "lucide-react";
import { daisyVoice } from "../lib/voice";
import { spotify, SpotifyRequestError, type NowPlaying } from "../lib/spotify";
import WaveformHero from "./WaveformHero";

interface DaisyDashboardProps {
  onNavigate: (tab: "daisy" | "music" | "notes" | "calendar" | "gmail") => void;
  onSubmitPrompt: (text: string) => void;
  notesCount: number;
  eventsCount: number;
  voiceTranscript?: string;
  voiceProcessing?: boolean;
  userName?: string;
}

/** Clock for a mail timestamp; falls back to the raw value if it won't parse. */
function formatMailTime(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  userName,
}: DaisyDashboardProps) {
  // Voice engine & Music state
  const [voiceIsMuted, setVoiceIsMuted] = useState<boolean>(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const musicIsPlaying = !!nowPlaying?.playing;
  // Spotify Connect can only play onto an *open* Spotify app. With none running
  // every play call fails with "no device"; we track this so the widget can say
  // so up front instead of firing a doomed request that 404s in the console.
  const [hasDevice, setHasDevice] = useState<boolean>(true);
  const [musicHint, setMusicHint] = useState<string>("");
  
  // Inbox preview. The dashboard deliberately does no Gmail fetching of its
  // own — it reads whatever the Mail tab last cached, so this tile is either
  // real mail or an honest empty state, never a placeholder dressed up as one.
  const mailStatus = readCache<GmailStatus>(CACHE_KEYS.gmailStatus);
  const mailConnected = !!mailStatus?.gmailAuthorized;
  const cachedInbox = readCache<GmailMessage[]>(CACHE_KEYS.gmailMessages("INBOX", "")) ?? [];
  const latestMail = cachedInbox[0] ?? null;
  const unreadCount = cachedInbox.filter((m) => m.unread).length;

  // Real-time task checklists synced with localStorage
  const [localNotes, setLocalNotes] = useState<LocalNote[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState<string>("");

  const todaySummary = useMemo(() => {
    const todayLabel = new Date().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    return {
      label: todayLabel,
      meetingText: eventsCount > 0 ? `${eventsCount} scheduled item${eventsCount === 1 ? "" : "s"}` : "No calendar events yet",
      noteText: notesCount > 0 ? `${notesCount} saved note${notesCount === 1 ? "" : "s"}` : "No notes yet",
      nextAction: eventsCount > 0 && notesCount > 0
        ? "Ask Daisy to summarize your day"
        : "Ask Daisy to create your first note or event",
    };
  }, [eventsCount, notesCount]);

  // Load notes & initialize listeners on mount
  useEffect(() => {
    // Sync local notes checklist
    const loadNotes = () => {
      const saved = localStorage.getItem("daisy_plain_notes");
      if (saved) {
        try {
          setLocalNotes(JSON.parse(saved));
        } catch (e) {}
      }
    };
    loadNotes();

    // Keep the widget in step with whatever Spotify is actually playing, and
    // whether there's any device to play onto.
    const syncNowPlaying = async () => {
      try {
        const [np, devices] = await Promise.all([spotify.nowPlaying(), spotify.devices()]);
        setNowPlaying(np);
        setHasDevice(devices.length > 0);
      } catch {
        /* Spotify not connected — the widget shows its idle state */
      }
    };
    syncNowPlaying();
    const nowPlayingTimer = window.setInterval(syncNowPlaying, 10000);

    // Check mute state of Daisy Voice Core
    setVoiceIsMuted(!daisyVoice.getEnabled());

    return () => clearInterval(nowPlayingTimer);
  }, []);

  // Quick speak trigger for voice-first listener
  const triggerVocalSpeak = () => {
    const lines = [
      "Voice is online and ready. Tell me what to sync.",
      "I'm listening in the background — go ahead and focus, I've got this.",
      "Your notes and calendar are up to date.",
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
    setMusicHint("");
    // No open Spotify app means nothing can play. Say so instead of firing a
    // request we know will fail (and log a 404).
    if (!musicIsPlaying && !hasDevice) {
      setMusicHint("Open Spotify on your phone or Mac, then press Play.");
      return;
    }
    try {
      await (musicIsPlaying ? spotify.pause() : spotify.play());
      // Re-read rather than assuming: Spotify rejects control on free accounts
      // and when no device is open, and the widget should show the truth.
      setNowPlaying(await spotify.nowPlaying());
    } catch (err) {
      setMusicHint(
        err instanceof SpotifyRequestError ? err.message : "Couldn't reach Spotify just now."
      );
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
    localStorage.setItem("daisy_plain_notes", JSON.stringify(updated));
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
    localStorage.setItem("daisy_plain_notes", JSON.stringify(updated));
  };

  return (
    <div id="daisy-dashboard-view" className="h-full flex flex-col p-6 md:p-10 text-zinc-800 overflow-y-auto select-none relative">
      
      {/* Main Greeting Display */}
      <div className="mt-2 mb-10 text-center sm:text-left">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-zinc-950 font-sans leading-none">
          Hi{userName ? ` ${userName}` : ""}, Ready to<br />
          Achieve Great Things?
        </h1>
      </div>

      {/* Hero: live animated waveform (replaces the feature cards) */}
      <WaveformHero playing={musicIsPlaying} transcript={voiceTranscript} processing={voiceProcessing} onTalk={() => onNavigate("daisy")} />

      <div className="mb-8 rounded-[28px] border border-white/35 bg-white/25 backdrop-blur-xl p-4 shadow-sm relative z-20">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Today</p>
            <h2 className="text-xl font-black text-zinc-900 tracking-tight">{todaySummary.label}</h2>
          </div>
          <button
            onClick={() => onNavigate("daisy")}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-[10px] font-black text-amber-800 transition-all hover:bg-amber-200 cursor-pointer"
          >
            Ask Daisy
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
          <Card className="p-4 pt-7">
            <CardBadge icon={CalendarDays} accent="blue" />
            <CardTitle>Schedule</CardTitle>
            <p className="mt-1.5 text-[13px] font-semibold text-zinc-900">{todaySummary.meetingText}</p>
            <CardBody className="mt-1">Plan your day, create a reminder, or ask Daisy to block time.</CardBody>
          </Card>

          <Card className="p-4 pt-7">
            <CardBadge icon={NotebookPen} accent="amber" />
            <CardTitle>Notes</CardTitle>
            <p className="mt-1.5 text-[13px] font-semibold text-zinc-900">{todaySummary.noteText}</p>
            <CardBody className="mt-1">Capture thoughts, ideas, and action items before they disappear.</CardBody>
          </Card>

          <Card className="p-4 pt-7">
            <CardBadge icon={Sparkles} accent="emerald" />
            <CardTitle>Next move</CardTitle>
            <p className="mt-1.5 text-[13px] font-semibold text-zinc-900">{todaySummary.nextAction}</p>
            <CardBody className="mt-1">Perfect for a real assistant flow: quick, helpful, and easy to act on.</CardBody>
          </Card>
        </div>
      </div>

      {notesCount === 0 || eventsCount === 0 ? (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 relative z-20">
          {notesCount === 0 && (
            <Card className="p-5 pt-8">
              <CardBadge icon={NotebookPen} accent="amber" />
              <CardTitle>No notes yet</CardTitle>
              <CardBody className="mt-1.5">Ask Daisy to capture a thought, task, or meeting note and it will appear here instantly.</CardBody>
              <CardAction className="mt-4" onClick={() => onNavigate("notes")}>Add a note</CardAction>
            </Card>
          )}

          {eventsCount === 0 && (
            <Card className="p-5 pt-8">
              <CardBadge icon={CalendarDays} accent="blue" />
              <CardTitle>No calendar items</CardTitle>
              <CardBody className="mt-1.5">Create a meeting, reminder, or task with a natural prompt like “schedule a focus block at 3pm.”</CardBody>
              <CardAction className="mt-4" onClick={() => onNavigate("calendar")}>Add an event</CardAction>
            </Card>
          )}
        </div>
      ) : null}

      {/* Slim quick-access to each workspace */}
      <div className="flex flex-wrap gap-2 mb-10 relative z-20">
        {[
          { label: "Tasks", tab: "notes" as const, color: "text-amber-600" },
          { label: "Mail", tab: "gmail" as const, color: "text-rose-500" },
          { label: "Music", tab: "music" as const, color: "text-emerald-600" },
          { label: "Calendar", tab: "calendar" as const, color: "text-blue-500" },
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Widget 1: Interactive Task Checklist */}
            <Card className="p-5 pt-8 flex flex-col justify-between min-h-[170px]">
              <CardBadge icon={ListTodo} accent="amber" />
              <div>
                <CardTitle count={`${localNotes.filter(n => n.title.startsWith("✓ ")).length}/${localNotes.length}`}>
                  Today's checklist
                </CardTitle>

                {/* Checklist display */}
                <div className="mt-3 space-y-1 max-h-[92px] overflow-y-auto pr-1 -ml-1.5">
                  {localNotes.slice(0, 3).map((note) => {
                    const isDone = note.title.startsWith("✓ ");
                    const cleanTitle = note.title.replace("✓ ", "");
                    return (
                      <div
                        key={note.id}
                        onClick={() => handleToggleTask(note.id)}
                        className="flex items-center gap-2.5 px-1.5 py-1.5 hover:bg-zinc-50 rounded-lg cursor-pointer transition-all"
                      >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                          isDone ? "bg-amber-500 border-amber-500 text-white" : "border-zinc-300 bg-white"
                        }`}>
                          {isDone && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className={`text-[13px] truncate leading-snug ${isDone ? "line-through text-zinc-400" : "text-zinc-700"}`}>
                          {cleanTitle}
                        </span>
                      </div>
                    );
                  })}
                  {localNotes.length === 0 && (
                    <CardBody className="py-1">No pending tasks — add one below.</CardBody>
                  )}
                </div>
              </div>

              {/* Quick Append Task Form */}
              <form onSubmit={handleAddQuickTask} className="flex gap-2 mt-4 pt-4 border-t border-zinc-100">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add a task…"
                  className="flex-1 min-w-0 bg-white border border-zinc-300 rounded-[10px] px-3 py-2 text-[13px] text-zinc-800 placeholder:text-zinc-400 shadow-[0_1px_2px_rgba(16,24,40,0.05)] focus:outline-none focus:border-zinc-400"
                />
                <CardAction type="submit" aria-label="Add task">
                  <Plus className="w-3.5 h-3.5" />
                </CardAction>
              </form>
            </Card>

            {/* Widget 2: Spotify Soundscape Player */}
            <Card className="p-5 pt-8 flex flex-col justify-between min-h-[170px]">
              <CardBadge icon={Music} accent="emerald" />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Spotify</CardTitle>
                  {musicIsPlaying && (
                    <span className="flex items-center gap-0.5 shrink-0">
                      <span className="w-1 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="w-1 h-3 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                      <span className="w-1 h-1 bg-emerald-500 rounded-full" />
                    </span>
                  )}
                </div>

                {/* Track metadata block */}
                <div className="mt-3 flex items-start gap-3">
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
                    <h4 className="text-[13px] font-semibold text-zinc-900 truncate leading-snug">
                      {nowPlaying?.track?.name || "Nothing playing"}
                    </h4>
                    <p className="text-[13px] text-zinc-500 truncate leading-relaxed">
                      {nowPlaying?.track?.artist ||
                        (hasDevice ? "Ask Daisy to play something" : "No open Spotify device")}
                    </p>
                  </div>
                </div>

                {musicHint && (
                  <p className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200/70 rounded-[10px] px-2.5 py-1.5 leading-snug">
                    {musicHint}
                  </p>
                )}
              </div>

              {/* Controls Row */}
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-zinc-100">
                <CardAction onClick={handleToggleMusic}>
                  {musicIsPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {musicIsPlaying ? "Pause" : "Play"}
                </CardAction>
                <CardAction
                  onClick={async () => {
                    setMusicHint("");
                    if (!hasDevice) {
                      setMusicHint("Open Spotify on your phone or Mac first.");
                      return;
                    }
                    try {
                      await spotify.next();
                      setNowPlaying(await spotify.nowPlaying());
                    } catch (err) {
                      setMusicHint(
                        err instanceof SpotifyRequestError ? err.message : "Couldn't reach Spotify."
                      );
                    }
                  }}
                  title="Next track"
                >
                  Skip
                </CardAction>
              </div>
            </Card>

            {/* Widget 3: Inbox preview, read from whatever the Mail tab last cached */}
            <Card className="p-5 pt-8 flex flex-col justify-between min-h-[170px]">
              <CardBadge icon={Mail} accent="rose" />
              <div>
                <CardTitle count={unreadCount > 0 ? `${unreadCount} unread` : undefined}>
                  Inbox
                </CardTitle>

                <div className="mt-3">
                  {!mailConnected ? (
                    <CardBody>
                      Connect Gmail to see your latest mail here.
                    </CardBody>
                  ) : latestMail ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-zinc-900 truncate">
                          {latestMail.subject || "(no subject)"}
                        </span>
                        <span className="text-[12px] text-zinc-400 shrink-0">
                          {formatMailTime(latestMail.date)}
                        </span>
                      </div>
                      <CardBody className="truncate mt-0.5">{latestMail.snippet}</CardBody>
                    </>
                  ) : (
                    <CardBody>Nothing to show yet — open Mail to load your inbox.</CardBody>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-100">
                <CardAction onClick={() => onNavigate("gmail")}>
                  {mailConnected ? "Open inbox" : "Connect Gmail"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </CardAction>
              </div>
            </Card>

          </div>

        {/* Footer Brand Info Line */}
        <div className="flex items-center justify-end text-[11px] text-zinc-500 pt-2 px-2 border-t border-zinc-200/30">
          <span className="font-mono text-zinc-400 font-semibold">Daisy v1</span>
        </div>

      </div>

    </div>
  );
}
