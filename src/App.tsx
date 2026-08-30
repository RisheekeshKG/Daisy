import React, { useState, useEffect, useRef } from "react";
import { Bot, Music, FileText, Calendar as CalendarIcon, Radio, Laptop, Plus, Search, Compass, LayoutGrid as Grid, Clock, Mail, Mic, MicOff, Settings as SettingsIcon } from "lucide-react";
import { Note, CalendarEvent, ChatMessage } from "./types";
import { daisyVoice } from "./lib/voice";
import { daisyListener, describeListenError, type ListenState } from "./lib/listen";
import { spotify, SpotifyRequestError } from "./lib/spotify";
import { gcal } from "./lib/gcal";
import DaisyAgent, { DaisyFlower, YellowTie, DaisyMascotAvatar } from "./components/DaisyAgent";
import MediaSpotify from "./components/MediaSpotify";
import WorkspaceNotion from "./components/WorkspaceNotion";
import CalendarSchedule from "./components/CalendarSchedule";
import DaisyDashboard from "./components/DaisyDashboard";
import WorkspaceGmail from "./components/WorkspaceGmail";
import OnboardingModal from "./components/OnboardingModal";
import SettingsPage from "./components/SettingsPage";
import { BootSplash } from "./components/Skeleton";
import { evictAll } from "./lib/cache";
import { motion, AnimatePresence } from "motion/react";
import { daisyBridge } from "./lib/daisyBridge";
import { getUserName, setUserName as persistUserName } from "./lib/userName";
import { classifyAddressee, normalizeTranscript } from "./lib/addressing";

/**
 * First-run starter content.
 *
 * This seeds an empty install so the notes and calendar tabs aren't a blank
 * wall on day one. It is deliberately written as a welcome — a short tour of
 * what Daisy can do — rather than as invented user history, so nobody mistakes
 * it for their own data. It is written once; after that the user's real
 * content is what loads.
 */
const STARTER_NOTES: Note[] = [
  {
    id: "note_welcome",
    title: "Welcome to Daisy",
    content: [
      "# Welcome to Daisy",
      "",
      "This is your notes workspace. Everything here is stored locally on this",
      "machine — nothing is uploaded.",
      "",
      "## Things to try",
      "",
      "- Type `/` in a document to open the block menu",
      "- Start a line with `# `, `- `, or `[] ` to convert it as you type",
      "- Ask Daisy to capture a note for you — just talk, there's no wake word",
      "",
      "Delete this note whenever you like.",
    ].join("\n"),
    tags: ["welcome"],
    updatedAt: new Date().toISOString(),
  },
];

/** Starter events are seeded relative to today so they land on a visible day. */
function starterEvents(): CalendarEvent[] {
  const at = (dayOffset: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    // Local YYYY-MM-DDTHH:MM — toISOString() would shift this by the UTC offset.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };

  return [
    {
      id: "event_welcome",
      title: "Try asking Daisy to schedule something",
      start: at(0, 10),
      end: at(0, 11),
      description:
        "Say or type something like \u201cblock an hour for focus work tomorrow at 2\u201d and Daisy will add it here.",
      category: "personal",
      completed: false,
    },
  ];
}

/**
 * Carry data across the jarvis_* -> daisy_* storage rename.
 *
 * Without this, renaming the keys would silently orphan every note, event and
 * chat message already saved on this machine — the app would look like a fresh
 * install. Runs once: after copying, the new keys exist and it no-ops. The old
 * keys are left in place so downgrading doesn't lose anything either.
 */
function migrateLegacyStorage() {
  const renames: Array<[string, string]> = [
    ["jarvis_plain_notes", "daisy_plain_notes"],
    ["jarvis_plain_events", "daisy_plain_events"],
    ["jarvis_chat_history", "daisy_chat_history"],
    ["jarvis_agent_view", "daisy_agent_view"],
  ];
  try {
    for (const [oldKey, newKey] of renames) {
      const legacy = localStorage.getItem(oldKey);
      if (legacy !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, legacy);
      }
    }
    // Stored chat messages tag the assistant's turns by role; the renamed role
    // has to be rewritten or old replies stop rendering as Daisy's.
    const history = localStorage.getItem("daisy_chat_history");
    if (history && history.includes('"jarvis"')) {
      const fixed = JSON.parse(history).map((m: any) =>
        m?.role === "jarvis" ? { ...m, role: "daisy" } : m
      );
      localStorage.setItem("daisy_chat_history", JSON.stringify(fixed));
    }
  } catch {
    /* storage unavailable or corrupt — fall through to defaults */
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"home" | "daisy" | "music" | "notes" | "calendar" | "gmail" | "settings">("home");
  const [initialPrompt, setInitialPrompt] = useState<string>("");
  // False until local data is hydrated — gates the boot splash below.
  const [booted, setBooted] = useState(false);

  // Who Daisy is talking to — asked once on first launch (OnboardingModal)
  // rather than baked into the source, so this project runs for anyone who
  // clones it.
  const [userName, setUserName] = useState<string>(() => getUserName());
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !getUserName());
  const handleOnboardingSubmit = (name: string) => {
    setUserName(persistUserName(name));
    setShowOnboarding(false);
  };

  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Music state — mirrors real Spotify playback (there is no local player).
  // Ducking and the listener's VAD profile both depend on knowing a song is
  // on, so the poll below also exposes itself here: waiting up to a full poll
  // interval after Daisy starts a track would mean the first thing you say
  // over it is neither ducked nor heard.
  const syncNowPlayingRef = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState<boolean>(false);
  const [activeTrackTitle, setActiveTrackTitle] = useState<string>("None");

  // Google Calendar sync state
  const [gcalConnected, setGcalConnected] = useState<boolean>(false);
  const [gcalSyncing, setGcalSyncing] = useState<boolean>(false);
  const [gcalError, setGcalError] = useState<string>("");
  const [gcalLastSync, setGcalLastSync] = useState<string>("");

  // Time stamp state
  const [time, setTime] = useState<string>("");

  // Real Electron window chrome state (no-ops outside the desktop app)
  const isElectron = !!daisyBridge;
  // macOS gets the OS's real traffic-light buttons (see electron/main.cjs);
  // every other platform keeps the fully custom frameless controls below.
  const isMacNativeChrome = daisyBridge?.platform === "darwin";
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [showQuitDialog, setShowQuitDialog] = useState<boolean>(false);

  useEffect(() => {
    if (!daisyBridge) return;
    daisyBridge.isMaximized().then(setIsMaximized);
    return daisyBridge.onMaximizedChange(setIsMaximized);
  }, []);

  useEffect(() => {
    if (!daisyBridge) return;
    // The native traffic-light red button triggers this instead of closing
    // outright, so it goes through the same confirm dialog as the button.
    return daisyBridge.onCloseRequested(() => setShowQuitDialog(true));
  }, []);

  useEffect(() => {
    // Ticking desktop clock
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Hydrate notes & events with local storage
  useEffect(() => {
    migrateLegacyStorage();
    const savedNotes = localStorage.getItem("daisy_plain_notes");
    const savedEvents = localStorage.getItem("daisy_plain_events");
    
    if (savedNotes) {
      try { setNotes(JSON.parse(savedNotes)); } catch(e) {}
    } else {
      setNotes(STARTER_NOTES);
      localStorage.setItem("daisy_plain_notes", JSON.stringify(STARTER_NOTES));
    }
    
    if (savedEvents) {
      try { setEvents(JSON.parse(savedEvents)); } catch(e) {}
    } else {
      const seeded = starterEvents();
      setEvents(seeded);
      localStorage.setItem("daisy_plain_events", JSON.stringify(seeded));
    }

    // Local data is hydrated, so the shell has real content to draw. Held for
    // one paint so the splash doesn't strobe on a fast machine — anything that
    // still needs the network (calendar, mail, playback) shows its own skeleton
    // rather than holding the whole window hostage.
    const id = window.setTimeout(() => setBooted(true), 350);
    return () => window.clearTimeout(id);
  }, []);

  // Notes action handlers
  const handleAddNote = async (newNoteData: { title: string; content: string; tags: string[] }) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: newNoteData.title,
      content: newNoteData.content,
      tags: newNoteData.tags,
      updatedAt: new Date().toISOString()
    };

    const updated = [newNote, ...notes];
    setNotes(updated);
    setSelectedNoteId(newNote.id);
    localStorage.setItem("daisy_plain_notes", JSON.stringify(updated));
  };

  const handleDeleteNote = async (id: string) => {
    const updated = notes.filter(n => n.id !== id);
    setNotes(updated);
    if (selectedNoteId === id) setSelectedNoteId(null);
    localStorage.setItem("daisy_plain_notes", JSON.stringify(updated));
  };

  const handleUpdateNote = async (updatedNote: Note) => {
    const updated = notes.map(n => n.id === updatedNote.id ? updatedNote : n);
    setNotes(updated);
    localStorage.setItem("daisy_plain_notes", JSON.stringify(updated));
  };

  /** Persist the events list; single place that writes the storage key. */
  const commitEvents = (updated: CalendarEvent[]) => {
    setEvents(updated);
    localStorage.setItem("daisy_plain_events", JSON.stringify(updated));
  };

  // Calendar Event handlers
  const handleAddEvent = async (newEventData: Omit<CalendarEvent, "id">) => {
    const newEvent: CalendarEvent = {
      ...newEventData,
      id: crypto.randomUUID()
    };
    // Push to Google first when connected, so the local copy is saved already
    // carrying its googleId and the next sync recognises it as the same event.
    if (gcalConnected) {
      try {
        const remote = await gcal.createEvent({
          title: newEvent.title,
          start: newEvent.start,
          end: newEvent.end,
          description: newEvent.description,
        });
        newEvent.googleId = remote.googleId;
      } catch (err) {
        setGcalError(err instanceof Error ? err.message : "Could not add that to Google Calendar.");
      }
    }
    commitEvents([...events, newEvent]);
  };

  const handleDeleteEvent = async (id: string) => {
    const target = events.find(e => e.id === id);
    if (gcalConnected && target?.googleId) {
      try {
        await gcal.deleteEvent(target.googleId);
      } catch (err) {
        setGcalError(err instanceof Error ? err.message : "Could not remove that from Google Calendar.");
      }
    }
    commitEvents(events.filter(e => e.id !== id));
  };

  /**
   * Pull Google Calendar into the local list.
   *
   * Google is authoritative for anything carrying a googleId: those entries are
   * replaced wholesale (and dropped if they disappeared upstream), while local
   * fields the API doesn't know about — category, priority, subtasks, completed
   * — are preserved from the existing copy. Local-only events are left alone.
   */
  const syncGoogleCalendar = async () => {
    setGcalSyncing(true);
    setGcalError("");
    try {
      const remote = await gcal.events();
      setEvents((prev) => {
        const byGoogleId = new Map<string, CalendarEvent>(
          prev.filter(e => e.googleId).map(e => [e.googleId as string, e])
        );
        const merged: CalendarEvent[] = [
          ...prev.filter(e => !e.googleId),
          ...remote.map((r) => {
            const existing = byGoogleId.get(r.googleId);
            return {
              ...existing,
              id: existing?.id ?? crypto.randomUUID(),
              googleId: r.googleId,
              title: r.title,
              start: r.start,
              end: r.end,
              description: r.description || existing?.description,
              category: existing?.category ?? ("work" as const),
            };
          }),
        ];
        localStorage.setItem("daisy_plain_events", JSON.stringify(merged));
        return merged;
      });
      setGcalLastSync(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (err) {
      setGcalError(err instanceof Error ? err.message : "Could not sync Google Calendar.");
    } finally {
      setGcalSyncing(false);
    }
  };

  // Check the Google connection on start, and pull once if it is live.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await gcal.status();
        if (cancelled) return;
        setGcalConnected(s.connected);
        // Signed in but Google still refuses (e.g. the Calendar API is not
        // enabled on the project). Show why — re-authorizing would not help.
        if (!s.connected && s.authorized && s.error) setGcalError(s.error);
        if (s.connected) syncGoogleCalendar();
      } catch {
        /* backend not up yet — the Calendar tab can retry */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleConnectGoogleCalendar = async () => {
    setGcalError("");
    try {
      await gcal.connect();
      // The consent flow finishes in an external browser, so poll for the
      // backend flipping to connected rather than assuming it worked.
      const started = Date.now();
      const poll = window.setInterval(async () => {
        try {
          const s = await gcal.status();
          if (s.connected) {
            window.clearInterval(poll);
            setGcalConnected(true);
            syncGoogleCalendar();
          } else if (s.authorized && s.error) {
            // Sign-in worked but Google still rejects us. Waiting cannot fix
            // that, so stop and say what actually needs changing.
            window.clearInterval(poll);
            setGcalError(s.error);
          } else if (Date.now() - started > 180000) {
            window.clearInterval(poll);
            setGcalError("Google sign-in didn't complete. Try connecting again.");
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (err) {
      setGcalError(err instanceof Error ? err.message : "Could not start Google sign-in.");
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    try {
      await gcal.disconnect();
    } catch {
      /* disconnect locally regardless */
    }
    setGcalConnected(false);
    setGcalLastSync("");
    // Drop the mirrored copies; local-only events stay.
    commitEvents(events.filter(e => !e.googleId));
    // Gmail rides the same Google connection, so disconnecting here signs the
    // inbox out too. Purge the caches or the next visit to Mail would repaint
    // the previous account's messages from localStorage.
    evictAll();
  };

  const handleToggleComplete = async (id: string) => {
    const updated = events.map(e => e.id === id ? { ...e, completed: !e.completed } : e);
    setEvents(updated);
    localStorage.setItem("daisy_plain_events", JSON.stringify(updated));
  };

  const handleUpdateEvent = async (updatedEvent: CalendarEvent) => {
    // Mirror title/time edits upstream; local-only fields (subtasks, priority)
    // have no Google equivalent and stay on this machine.
    if (gcalConnected && updatedEvent.googleId) {
      try {
        await gcal.updateEvent(updatedEvent.googleId, {
          title: updatedEvent.title,
          start: updatedEvent.start,
          end: updatedEvent.end,
          description: updatedEvent.description,
        });
      } catch (err) {
        setGcalError(err instanceof Error ? err.message : "Could not update that in Google Calendar.");
      }
    }
    commitEvents(events.map(e => e.id === updatedEvent.id ? updatedEvent : e));
  };

  const handlePlayingChange = (isPlaying: boolean) => {
    setPlaying(isPlaying);
  };

  // Execute automation commands returned by Daisy
  const handleExecuteCommand = async (cmd: { type: string; payload: any }) => {
    console.log("Daisy automation command:", cmd);
    switch (cmd.type) {
      case "ADD_EVENT":
        await handleAddEvent({
          title: cmd.payload.title || "Scheduled Daisy Event",
          start: cmd.payload.start || new Date().toISOString().substring(0, 16),
          end: cmd.payload.end || new Date(Date.now() + 3600000).toISOString().substring(0, 16),
          description: cmd.payload.description || "Added proactively by Daisy",
          category: "ai",
          completed: false,
        });
        break;
      case "ADD_NOTE":
        await handleAddNote({
          title: cmd.payload.title || "Daisy Memo Draft",
          content: cmd.payload.content || "# Memo\nProactively derived by neural workspace.",
          tags: cmd.payload.tags || ["daisy"],
        });
        break;
      case "PLAY_SPOTIFY":
        // Daisy already spoke her reply by the time this runs, so surface any
        // failure (no device open, not Premium) as a follow-up instead of
        // letting it fail silently after she claimed to play something.
        try {
          // Spotify Connect can't play without an open Spotify app. Check first
          // so a common, expected situation becomes a spoken hint rather than a
          // 404 in the console from a request that was never going to succeed.
          const devices = await spotify.devices();
          if (devices.length === 0) {
            daisyVoice.speakAfterCurrent(
              "Open the Spotify app on your phone or Mac first, then ask me again."
            );
            break;
          }
          await spotify.playQuery(cmd.payload.query || "");
          syncNowPlayingRef.current();
        } catch (err) {
          const msg =
            err instanceof SpotifyRequestError
              ? err.message
              : "I couldn't reach Spotify just now.";
          daisyVoice.speakAfterCurrent(msg);
        }
        break;
      case "SPOTIFY_CONTROL":
        try {
          switch (cmd.payload.action) {
            case "pause": await spotify.pause(); break;
            case "resume": await spotify.play(); break;
            case "next": await spotify.next(); break;
            case "previous": await spotify.previous(); break;
            case "shuffle_on": await spotify.setShuffle(true); break;
            case "shuffle_off": await spotify.setShuffle(false); break;
            case "volume": await spotify.setVolume(Number(cmd.payload.percent ?? 50)); break;
            case "repeat_off": await spotify.setRepeat("off"); break;
            case "repeat_all": await spotify.setRepeat("context"); break;
            case "repeat_one": await spotify.setRepeat("track"); break;
            case "restart": await spotify.seek(0); break;
            case "seek_forward": await spotify.seekBy(Number(cmd.payload.seconds ?? 30) * 1000); break;
            case "seek_back": await spotify.seekBy(-Number(cmd.payload.seconds ?? 30) * 1000); break;
            case "queue": await spotify.queue(String(cmd.payload.query ?? "")); break;
            case "like": await spotify.saveCurrent(true); break;
            case "unlike": await spotify.saveCurrent(false); break;
            default: console.warn("Unknown Spotify action:", cmd.payload.action);
          }
          syncNowPlayingRef.current();
        } catch (err) {
          const msg =
            err instanceof SpotifyRequestError
              ? err.message
              : "I couldn't reach Spotify just now.";
          daisyVoice.speakAfterCurrent(msg);
        }
        break;
      case "SET_PLAYBACK":
        // Playback is Spotify's now that the built-in synth is gone.
        if (cmd.payload.playing !== undefined) {
          try {
            await (cmd.payload.playing ? spotify.play() : spotify.pause());
            setPlaying(!!cmd.payload.playing);
            syncNowPlayingRef.current();
          } catch (err) {
            const msg =
              err instanceof SpotifyRequestError
                ? err.message
                : "I couldn't reach Spotify just now.";
            daisyVoice.speakAfterCurrent(msg);
          }
        }
        break;
      default:
        console.warn("Command not handled:", cmd);
    }
  };

  // Submission handler from bottom Daisy bar
  const handleDashboardPromptSubmit = (text: string) => {
    setInitialPrompt(text);
    setActiveTab("daisy");
  };

  // ---- Ducking: turn the song down so Daisy can hear you ------------------
  // Speaking over a song only clears it by a few dB at the microphone, which
  // is why recognition falls apart while music plays. Spotify runs on a
  // Connect device (the desktop app, a phone, a speaker) rather than in this
  // process, so there is no local audio element to fade — ducking has to go
  // through the volume API, and every path below is written so a failure
  // leaves the user's music loud rather than stuck quiet.
  const DUCK_RATIO = 0.25;
  const playingRef = useRef(false);
  /** Last volume Spotify reported while we were *not* ducking. */
  const musicVolumeRef = useRef<number | null>(null);
  /** The volume to put back, or null when the song is at full volume. */
  const duckedFromRef = useRef<number | null>(null);
  const duckOpRef = useRef<Promise<unknown>>(Promise.resolve());
  const voiceRecordingRef = useRef(false);

  /** Serialize volume writes so a duck and a restore can never land inverted. */
  const queueVolume = (fn: () => Promise<void>) => {
    duckOpRef.current = duckOpRef.current.then(fn, fn).catch(() => {});
  };

  const duckMusic = () => {
    if (duckedFromRef.current !== null) return; // already down
    const from = musicVolumeRef.current;
    if (!playingRef.current || from === null || from <= 0) return;
    const target = Math.max(5, Math.round(from * DUCK_RATIO));
    if (target >= from) return;
    // Claimed before the request goes out, so a second speech onset arriving
    // mid-flight can't duck again and lose the original volume.
    duckedFromRef.current = from;
    queueVolume(async () => {
      try {
        await spotify.setVolume(target);
      } catch {
        // Plenty of Connect devices refuse volume control. Forget we tried, so
        // the restore never pushes the volume somewhere the user didn't set it.
        duckedFromRef.current = null;
      }
    });
  };

  const restoreMusic = () => {
    const from = duckedFromRef.current;
    if (from === null) return;
    duckedFromRef.current = null;
    queueVolume(async () => {
      try {
        await spotify.setVolume(from);
      } catch {
        /* the song stays where it is; the next duck re-reads the real volume */
      }
    });
  };

  // Keep the footer and Daisy's context in sync with what Spotify is actually
  // playing. Polls gently and stays quiet when Spotify isn't connected.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const np = await spotify.nowPlaying();
        if (cancelled) return;
        setPlaying(!!np?.playing);
        playingRef.current = !!np?.playing;
        setActiveTrackTitle(np?.track?.name || "None");
        // Relaxes the listener's VAD margins: speech has to clear a song by a
        // far smaller margin than it clears a quiet room.
        daisyListener.setMusicPlaying(!!np?.playing);
        // Only trust the reported volume while we are not ducking — otherwise
        // we would learn our own ducked level as the one to restore to.
        if (duckedFromRef.current === null && typeof np?.device?.volumePercent === "number") {
          musicVolumeRef.current = np.device.volumePercent;
        }
      } catch {
        /* not connected or transient — leave the last known state alone */
      }
    };
    syncNowPlayingRef.current = sync;
    sync();
    const id = window.setInterval(sync, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ---- Global always-listening voice loop (works on any tab) --------------
  const [voiceListening, setVoiceListening] = useState<boolean>(false);
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState<string>("");
  const [voiceFinalTranscript, setVoiceFinalTranscript] = useState<string>("");
  // Why the mic is off, when it went off by itself (no speech permission, no
  // helper binary, helper crashed) rather than by the user clicking it.
  const [voiceError, setVoiceError] = useState<string>("");
  const voiceHandlerRef = useRef<(text: string) => void>(() => {});
  const voicePartialHandlerRef = useRef<(text: string) => void>(() => {});

  // True from "got a transcript" through "reply handed off to TTS" — i.e. the
  // STT-round-trip + LLM-thinking gap that isSpeaking()/isBusy() alone can't
  // see, since Daisy hasn't started (or even fetched) her reply yet. Combined
  // with daisyVoice.isBusy() this makes the mic strictly: listen, answer,
  // then listen again, with no overlap. Mirrored into React state so the
  // waveform can render it; the ref is what the listener's rAF loop reads
  // (a plain state closure captured once in useEffect would go stale).
  const voiceProcessingRef = useRef(false);
  const [voiceProcessing, setVoiceProcessingState] = useState(false);
  const setVoiceProcessing = (v: boolean) => {
    voiceProcessingRef.current = v;
    setVoiceProcessingState(v);
  };
  // Tracks whether handleVoiceMessage has taken over responsibility for
  // clearing voiceProcessing, so the listener's "transcribing" -> "listening"
  // transition (which fires right after a successful transcript, before this
  // async handler resolves) doesn't clear it out from under an in-flight reply.
  const voiceMessageInFlightRef = useRef(false);

  /**
   * Handle a spoken utterance: ask the LLM, then speak + execute the reply.
   *
   * `uncertain` means the local scorer couldn't tell whether this was even
   * meant for Daisy, so the model is asked to judge that too and may answer
   * notForMe. Nothing is written to the chat history until that comes back
   * clean — otherwise overheard conversation would pile up in the transcript
   * (and in the history sent with the next real request) even though Daisy
   * correctly stayed quiet about it.
   */
  const handleVoiceMessage = async (text: string, opts: { uncertain?: boolean } = {}) => {
    const transcript = text.trim().replace(/\s+/g, " ");
    if (!transcript) return;

    voiceMessageInFlightRef.current = true;
    // Nothing else raises this — without it the mic stays live for the whole
    // time Daisy is thinking and treats her own reply, or anything said
    // meanwhile, as the next utterance.
    setVoiceProcessing(true);
    setVoiceFinalTranscript(transcript);
    setVoiceDraftTranscript("");

    let history: ChatMessage[] = [];
    try {
      history = JSON.parse(localStorage.getItem("daisy_chat_history") || "[]");
    } catch {}

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: transcript,
      timestamp: new Date().toISOString(),
    };

    const commitHistory = (messages: ChatMessage[]) => {
      localStorage.setItem("daisy_chat_history", JSON.stringify(messages));
      window.dispatchEvent(new Event("daisy-chat-updated"));
    };

    // A confidently-addressed request goes into the transcript immediately, so
    // the chat tab reflects what was said while she is still thinking.
    if (!opts.uncertain) {
      history = [...history, userMsg];
      commitHistory(history);
    }

    try {
      const context = {
        currentTime: new Date().toISOString(),
        notesCount: notes.length,
        eventsCount: events.length,
        currentTrack: activeTrackTitle,
        userName,
      };
      const res = await fetch("/api/daisy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: transcript,
          history: history.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          context,
          // Asks the model to also rule on whether this was addressed to her.
          adjudicateAddressee: !!opts.uncertain,
        }),
      });
      const data = await res.json();

      // The model's verdict on an utterance the local scorer couldn't place:
      // it wasn't for Daisy, so say nothing and leave no trace of it.
      if (opts.uncertain && data.notForMe) {
        setLastAddressDecision("ignore (model: not addressed to Daisy)");
        voiceMessageInFlightRef.current = false;
        setVoiceProcessing(false);
        setVoiceFinalTranscript("");
        return;
      }

      if (opts.uncertain) {
        setLastAddressDecision("address (model: addressed to Daisy)");
        history = [...history, userMsg];
      }

      const replyText = data.text || "Sorry, I didn't catch that.";
      const daisyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "daisy",
        text: replyText,
        timestamp: new Date().toISOString(),
        commands: data.commands,
      };
      history = [...history, daisyMsg];
      commitHistory(history);

      // Handing off to TTS: daisyVoice.isBusy() becomes true synchronously
      // inside speak(), so clearing these here leaves no gap for the mic to
      // sneak in a new recording before playback actually starts.
      voiceMessageInFlightRef.current = false;
      setVoiceProcessing(false);

      // The model decides per-reply whether this exchange is still open (a
      // question, a pending choice) or done, which is what lowers the bar for
      // the next utterance. Setting this before speak() resolves is what
      // matters: the lapse timer only holds the window open while
      // conversationOpen is true, and it needs to be true before that timer's
      // next tick sees daisyVoice.isBusy(), so the window survives her reply.
      if (data.listenAfter) openConversationWindow();

      daisyVoice.speak(replyText);
      if (Array.isArray(data.commands)) {
        data.commands.forEach((cmd: any) => handleExecuteCommand(cmd));
      }
    } catch (err) {
      voiceMessageInFlightRef.current = false;
      setVoiceProcessing(false);
      // Staying silent on an utterance we were never sure was hers avoids
      // announcing a backend problem into somebody else's conversation.
      if (!opts.uncertain) {
        daisyVoice.speak("Sorry, I couldn't reach the backend just now.");
      }
    }
  };

  // --- Who was that meant for? ----------------------------------------------
  // There is no wake word: the mic is always live, so every utterance in the
  // room is a candidate and the real work is telling "play some jazz" (for
  // Daisy) from "did you see what she posted" (not). That runs in two stages:
  //
  //   1. src/lib/addressing.ts scores the transcript locally. Confident
  //      either way, it is settled here and room conversation never leaves
  //      the machine.
  //   2. Only genuinely ambiguous utterances are sent to the model, which can
  //      answer notForMe and have Daisy stay silent (see handleVoiceMessage).
  //
  // Saying "Daisy" still works and still wins outright — it is the deliberate
  // override for when the scorer guesses wrong — it just isn't required.
  //
  // While an exchange is open (the model's listenAfter, or a question she just
  // asked) the bar drops, so bare replies like "the second one" land. The
  // clock only runs while she is idle — the lapse timer below pushes the
  // deadline forward while she is still talking or thinking, since this is how
  // long she waits for *you*, not a deadline on her own reply.
  const FOLLOW_UP_WINDOW_MS = 7000;
  const conversationUntilRef = useRef(0);
  const [conversationOpen, setConversationOpen] = useState(false);
  // What the last decision was, surfaced in the mic tooltip so a wrong call is
  // debuggable rather than just silence.
  const [lastAddressDecision, setLastAddressDecision] = useState<string>("");

  const openConversationWindow = () => {
    conversationUntilRef.current = Date.now() + FOLLOW_UP_WINDOW_MS;
    setConversationOpen(true);
  };

  const closeConversationWindow = () => {
    conversationUntilRef.current = 0;
    setConversationOpen(false);
  };

  const handlePartialTranscript = (raw: string) => {
    const text = normalizeTranscript(raw);
    setVoiceDraftTranscript(text);
  };

  const handleSpokenTranscript = (raw: string) => {
    const text = normalizeTranscript(raw);
    if (!text) return;
    // A transcript arriving is proof the pipeline works, so clear any stale
    // "couldn't transcribe that" notice from an earlier utterance.
    setVoiceError("");

    const isOpen = conversationOpen || Date.now() < conversationUntilRef.current;
    const verdict = classifyAddressee(text, { conversationOpen: isOpen });
    setLastAddressDecision(`${verdict.decision} (${verdict.reasons.join(", ") || "no signals"})`);

    if (verdict.decision === "ignore") {
      // Room conversation. Drop it here: no chat history, no network call.
      setVoiceDraftTranscript("");
      return;
    }

    // Her name alone, with nothing after it, is still just an attention-getter.
    if (verdict.named && !verdict.text) {
      setVoiceFinalTranscript(text);
      openConversationWindow();
      daisyVoice.speak("Yes?");
      return;
    }

    // Close the window while the request is in flight; handleVoiceMessage
    // re-opens it if the model says the exchange is still going. Defaulting to
    // closed means a slow or failed request never leaves the mic hot on a guess.
    closeConversationWindow();
    void handleVoiceMessage(verdict.text || text, { uncertain: verdict.decision === "unsure" });
  };

  // Let the follow-up window lapse so the bar goes back up once the exchange
  // is over. Paused while she is mid-answer, so the countdown only measures
  // how long she has been waiting on the user.
  useEffect(() => {
    if (!conversationOpen) return;
    const id = window.setInterval(() => {
      if (voiceProcessingRef.current || daisyVoice.isBusy()) {
        conversationUntilRef.current = Date.now() + FOLLOW_UP_WINDOW_MS;
        return;
      }
      if (Date.now() >= conversationUntilRef.current) {
        closeConversationWindow();
        setVoiceDraftTranscript("");
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [conversationOpen]);

  // Keep the listener callbacks pointed at the latest handlers. buildListenHandlers
  // runs once, at mount, so anything it closes over directly (voiceAwake here)
  // would be frozen at its initial value forever.
  useEffect(() => {
    voiceHandlerRef.current = handleSpokenTranscript;
    voicePartialHandlerRef.current = handlePartialTranscript;
  });

  // Shared listener wiring for both the manual toggle and the on-mount
  // auto-start below. isBlocked strictly gates the mic on the full pipeline
  // (transcribing -> LLM thinking -> TTS busy), not just "audio playing", so
  // capture never starts again until the current turn is fully answered.
  const buildListenHandlers = () => ({
    onTranscript: (t: string) => voiceHandlerRef.current(t),
    onPartialTranscript: (t: string) => voicePartialHandlerRef.current(t),
    onState: (s: ListenState) => {
      voiceRecordingRef.current = s === "recording";
      // Duck on the speech onset itself rather than waiting for the watchdog
      // below — the point is to clear the rest of the sentence, and a tick of
      // delay is most of a short request.
      if (s === "recording") duckMusic();
      if (s === "transcribing") setVoiceProcessing(true);
      else if (s === "listening" && !voiceMessageInFlightRef.current) setVoiceProcessing(false);
    },
    isBlocked: () => voiceProcessingRef.current || daisyVoice.isBusy(),
    // Capture has stopped and won't recover on its own. Say why, instead of
    // flipping the mic off into a state that looks like the user did it.
    onError: (err: unknown) => {
      setVoiceListening(false);
      setVoiceProcessing(false);
      setVoiceError(describeListenError(err));
      console.error("Daisy voice:", err);
    },
    // One utterance failed (backend down, model still warming) but the mic is
    // still live — surface it without tearing voice mode down.
    onNotice: (message: string) => setVoiceError(message),
  });

  const toggleVoiceListening = async () => {
    if (daisyListener.isActive()) {
      daisyListener.stop();
      setVoiceListening(false);
      setVoiceDraftTranscript("");
      setVoiceFinalTranscript("");
      setVoiceProcessing(false);
      localStorage.setItem("daisy_always_listening", "false");
      return;
    }
    setVoiceError("");
    try {
      await daisyListener.start(buildListenHandlers());
      setVoiceListening(true);
      localStorage.setItem("daisy_always_listening", "true");
    } catch {
      setVoiceListening(false);
    }
  };

  // Hold the song down for the whole turn — capture, transcription, thinking,
  // Daisy's reply, and the follow-up window while she waits on you — then put
  // it back. Deliberately a poll rather than a restore on each transition: no
  // failed request, thrown handler or abandoned turn can end with the user's
  // music left quiet, because the next tick always finds the turn is over.
  useEffect(() => {
    const id = window.setInterval(() => {
      const turnActive =
        voiceRecordingRef.current ||
        voiceProcessingRef.current ||
        daisyVoice.isBusy() ||
        Date.now() < conversationUntilRef.current;
      if (turnActive) duckMusic();
      else restoreMusic();
    }, 250);
    return () => {
      window.clearInterval(id);
      restoreMusic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always-listening is on by default (Daisy waits for your voice); stop on teardown.
  useEffect(() => {
    if (localStorage.getItem("daisy_always_listening") !== "false") {
      daisyListener
        .start(buildListenHandlers())
        // StrictMode fires this effect twice, so one of the two start() calls
        // is superseded and resolves without owning the mic. Read the listener
        // rather than assuming this particular call is the one that won.
        .then(() => setVoiceListening(daisyListener.isActive()))
        .catch(() => setVoiceListening(false));
    }
    return () => daisyListener.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen bg-gradient-to-tr from-amber-200/25 via-zinc-100/40 to-rose-200/25 flex flex-col overflow-hidden relative font-sans">
      {/* Background soft ambient pastel decorative glows */}
      <div className="absolute top-[-150px] left-[-150px] w-[700px] h-[700px] bg-amber-300/20 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-[-150px] right-[-150px] w-[800px] h-[800px] bg-rose-300/25 rounded-full blur-[180px] pointer-events-none" />

      {/* Main app frame — fills the real Electron window, so this IS the window chrome */}
      <div className="bg-white/40 backdrop-blur-2xl flex flex-col overflow-hidden relative z-10 flex-1 min-h-0">
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />

        {/* Title bar: draggable region for the frameless window, with real window controls */}
        <div
          className={`h-11 bg-white/20 backdrop-blur-md border-b border-white/30 flex items-center justify-between select-none relative z-20 flex-shrink-0 ${
            isMacNativeChrome ? "pl-20 pr-4" : "px-4"
          }`}
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-3">
            {/* Non-mac: fully custom controls (no native traffic-light equivalent). */}
            {isElectron && !isMacNativeChrome && (
              <div className="flex gap-1.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                <button
                  onClick={() => setShowQuitDialog(true)}
                  className="w-3.5 h-3.5 rounded-full bg-rose-400 hover:bg-rose-500 border border-rose-500/25 flex items-center justify-center text-[7px] text-rose-950 font-black cursor-pointer transition-all active:scale-90"
                  title="Close Window"
                >
                  ×
                </button>
                <button
                  onClick={() => daisyBridge?.minimize()}
                  className="w-3.5 h-3.5 rounded-full bg-amber-400 hover:bg-amber-500 border border-amber-500/25 flex items-center justify-center text-[7px] text-amber-950 font-black cursor-pointer transition-all active:scale-90"
                  title="Minimize Window"
                >
                  -
                </button>
                <button
                  onClick={() => daisyBridge?.maximizeToggle()}
                  className="w-3.5 h-3.5 rounded-full bg-emerald-400 hover:bg-emerald-500 border border-emerald-500/25 flex items-center justify-center text-[6px] text-emerald-950 font-black cursor-pointer transition-all active:scale-90"
                  title={isMaximized ? "Restore Window" : "Maximize Window"}
                >
                  {isMaximized ? "⧉" : "⤢"}
                </button>
              </div>
            )}
            <div className="w-px h-4 bg-zinc-200 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
              <Laptop className="w-4 h-4 text-zinc-500" />
              <span className="font-sans font-extrabold tracking-tight">
                Daisy{userName ? ` • ${userName}'s Workspace` : ""} 🌼
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-zinc-600">
            {/* Mic master switch. When on, Daisy hears everything but only
                answers what the addressee scorer decides was aimed at her —
                the tooltip carries the last verdict so a wrong call is
                visible instead of just being silence. */}
            <button
              onClick={toggleVoiceListening}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title={
                voiceError
                  ? `${voiceError}${voiceListening ? "" : " Click to retry."}`
                  : !voiceListening
                  ? "Microphone off — click to let Daisy listen"
                  : conversationOpen
                  ? `In conversation — just keep talking${lastAddressDecision ? `\nLast: ${lastAddressDecision}` : ""}`
                  : `Listening — say what you want, or "Daisy" if she misses you${
                      lastAddressDecision ? `\nLast: ${lastAddressDecision}` : ""
                    }`
              }
              className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                voiceError
                  ? "bg-rose-100 border-rose-300 text-rose-700 hover:bg-rose-50"
                  : !voiceListening
                  ? "bg-white/60 border-zinc-200 text-zinc-500 hover:bg-white"
                  : conversationOpen
                  ? "bg-emerald-500 border-emerald-600 text-white shadow-sm"
                  : "bg-white/70 border-emerald-300 text-emerald-700"
              }`}
            >
              {voiceListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              <span className="text-[10px] font-bold tracking-tight">
                {voiceError
                  ? voiceListening
                    ? "Trouble hearing"
                    : "Can't hear"
                  : !voiceListening
                  ? "Off"
                  : conversationOpen
                  ? "In conversation"
                  : "Listening"}
              </span>
            </button>
            <span>{time}</span>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          </div>
        </div>

        {/* Content body divided into left structured navigation & central deck */}
        <div className="flex-1 flex min-h-0 relative z-10">
          
          {/* Vertical Glass Navigation Sidebar */}
          <div className="w-16 md:w-20 bg-white/10 backdrop-blur-md flex flex-col justify-between items-center py-6 border-r border-white/30 flex-shrink-0">
            {/* Circle Action Buttons */}
            <div className="flex flex-col gap-5 items-center w-full px-2">
              
              {/* Circle 1: Daisy Home Agent Bot */}
              <button
                onClick={() => {
                  setActiveTab("daisy");
                }}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer relative shrink-0 ${
                  activeTab === "daisy" ? "scale-105 ring-2 ring-amber-400/40 shadow-md" : "opacity-70 hover:opacity-100 hover:scale-105"
                }`}
                title="Daisy AI Assistant"
              >
                <DaisyMascotAvatar className="w-10 h-10" />
              </button>

              {/* Circle 2: Search Documents */}
              <button
                onClick={() => {
                  setActiveTab("notes");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "notes" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Search and Notes"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Circle 3: Compass/Discover (Spotify player) */}
              <button
                onClick={() => {
                  setActiveTab("music");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "music" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Acoustical player"
              >
                <Compass className="w-4 h-4" />
              </button>

              {/* Circle 4: Grid (Dashboard) */}
              <button
                onClick={() => {
                  setActiveTab("home");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "home" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Dashboard overview"
              >
                <Grid className="w-4 h-4" />
              </button>

              {/* Circle 5: Clock/History (Calendar) */}
              <button
                onClick={() => {
                  setActiveTab("calendar");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "calendar" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Scheduler and Calendar"
              >
                <Clock className="w-4 h-4" />
              </button>

              {/* Circle 6: Gmail Workspace */}
              <button
                onClick={() => {
                  setActiveTab("gmail");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "gmail" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Gmail Workspace"
              >
                <Mail className="w-4 h-4" />
              </button>

            </div>

            {/* Utility, kept apart from the six workspaces above it. */}
            <div className="flex flex-col items-center w-full px-2">
              <div className="w-6 h-px bg-zinc-300/60 mb-4" />
              <button
                onClick={() => setActiveTab("settings")}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "settings" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Settings"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dynamic Tab Deck with animations */}
          <div className="flex-1 min-h-0 relative bg-white/5">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full h-full"
              >
                {activeTab === "home" && (
                  <DaisyDashboard
                    onNavigate={setActiveTab}
                    onSubmitPrompt={handleDashboardPromptSubmit}
                    notesCount={notes.length}
                    eventsCount={events.length}
                    voiceTranscript={voiceDraftTranscript || voiceFinalTranscript}
                    voiceProcessing={voiceProcessing}
                    userName={userName}
                  />
                )}
                {activeTab === "daisy" && (
                  <DaisyAgent
                    onExecuteCommand={handleExecuteCommand}
                    notesCount={notes.length}
                    eventsCount={events.length}
                    currentTrackTitle={activeTrackTitle}
                    initialPrompt={initialPrompt}
                    onClearInitialPrompt={() => setInitialPrompt("")}
                  />
                )}
                {activeTab === "music" && <MediaSpotify />}
                {activeTab === "notes" && (
                  <WorkspaceNotion
                    notes={notes}
                    selectedNoteId={selectedNoteId}
                    onSelectNote={setSelectedNoteId}
                    onAddNote={handleAddNote}
                    onDeleteNote={handleDeleteNote}
                    onUpdateNote={handleUpdateNote}
                    isEncryptionActive={false} // encryption vault removed
                  />
                )}
                {activeTab === "calendar" && (
                  <CalendarSchedule
                    events={events}
                    onAddEvent={handleAddEvent}
                    onDeleteEvent={handleDeleteEvent}
                    onToggleComplete={handleToggleComplete}
                    onUpdateEvent={handleUpdateEvent}
                    googleConnected={gcalConnected}
                    googleSyncing={gcalSyncing}
                    googleError={gcalError}
                    googleLastSync={gcalLastSync}
                    onGoogleConnect={handleConnectGoogleCalendar}
                    onGoogleDisconnect={handleDisconnectGoogleCalendar}
                    onGoogleSync={syncGoogleCalendar}
                  />
                )}
                {activeTab === "gmail" && (
                  <WorkspaceGmail />
                )}
                {activeTab === "settings" && (
                  <SettingsPage
                    userName={userName}
                    onUserNameChange={setUserName}
                    alwaysListening={voiceListening}
                    onToggleAlwaysListening={toggleVoiceListening}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

        </div>

        {/* Global Synth Media HUD footer when playing audio */}
        {playing ? (
          <div className="h-10 max-md:hidden bg-white/20 border-t border-white/25 px-8 flex items-center justify-between text-[10px] font-mono text-zinc-500 relative z-30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-zinc-600 animate-pulse" />
              <span className="text-zinc-700 font-bold">STREAMING: {activeTrackTitle.toUpperCase()}</span>
            </div>
          </div>
        ) : (
          <footer className="h-10 max-md:hidden px-8 flex items-center justify-between text-[10px] font-semibold text-zinc-500 z-30 bg-white/20 border-t border-white/25">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>SYSTEM ACTIVE</span>
            </div>
          </footer>
        )}
      </div>

      {/* Boot splash — covers first paint, then fades out. Onboarding waits
          behind it so a new user never sees the name prompt flash over a
          half-drawn workspace. */}
      <AnimatePresence>{!booted && <BootSplash />}</AnimatePresence>

      <OnboardingModal open={booted && showOnboarding} onSubmit={handleOnboardingSubmit} />

      {/* Quit confirmation */}
      <AnimatePresence>
        {showQuitDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-zinc-900/95 border border-zinc-800 rounded-3xl p-6 text-white shadow-2xl relative"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                  <Laptop className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-extrabold text-zinc-100">Quit Daisy?</h3>
              </div>
              <p className="text-xs text-zinc-300 mb-6 leading-relaxed">
                Are you sure you want to close {userName ? `${userName}'s` : "your"} workspace? Any playing audio will stop.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowQuitDialog(false)}
                  className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowQuitDialog(false);
                    daisyBridge?.close();
                  }}
                  className="px-4 py-2 text-xs font-bold bg-rose-400 hover:bg-rose-500 text-zinc-950 rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Quit
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
