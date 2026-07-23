import React, { useState, useEffect, useRef } from "react";
import { Bot, Music, FileText, Calendar as CalendarIcon, Radio, Laptop, Plus, Search, Compass, LayoutGrid as Grid, Clock, Mail, Mic, MicOff } from "lucide-react";
import { Note, CalendarEvent, ChatMessage } from "./types";
import { daisyVoice } from "./lib/voice";
import { daisyListener, type ListenState } from "./lib/listen";
import { spotify, SpotifyRequestError } from "./lib/spotify";
import { gcal } from "./lib/gcal";
import DaisyAgent, { DaisyFlower, YellowTie, DaisyMascotAvatar } from "./components/DaisyAgent";
import MediaSpotify from "./components/MediaSpotify";
import WorkspaceNotion from "./components/WorkspaceNotion";
import CalendarSchedule from "./components/CalendarSchedule";
import DaisyDashboard from "./components/DaisyDashboard";
import WorkspaceGmail from "./components/WorkspaceGmail";
import { motion, AnimatePresence } from "motion/react";
import { daisyBridge } from "./lib/daisyBridge";

// Mock Initial plain notes
const INITIAL_PLAIN_NOTES: Note[] = [
  {
    id: "note_1",
    title: "Quantum Core Spec-Sheet",
    content: "# Quantum Core Diagnostics\nArc Reactor model: Mark LXXXV\n\n- Peak Output: 1.5 Gigawatts\n- Fuel Compound: Synthesized Vibranium Isotope\n- Core Cooling Status: Stable at 45.2 Kelvin\n\nEnsure neural inhibitors are fully synchronized before ignition Sir.",
    tags: ["core", "physics"],
    updatedAt: new Date(2026, 6, 21, 8, 0).toISOString(),
  },
  {
    id: "note_2",
    title: "Active Workspace Sentinel Protocol",
    content: "# Workspace Security Directive\n\nDaisy is monitoring all offline boundaries.\nAll notes inside this Notion workspace are designed to be client-side compiled.\n\n### Task Sync:\nEnsure daily study limits are scheduled to avoid bio-resonance fatigue.",
    tags: ["security", "daisy"],
    updatedAt: new Date(2026, 6, 21, 8, 30).toISOString(),
  }
];

// Mock Initial plain calendar events
const INITIAL_PLAIN_EVENTS: CalendarEvent[] = [
  {
    id: "event_1",
    title: "Quantum Core Diagnostics Run",
    start: "2026-07-21T10:00",
    end: "2026-07-21T11:00",
    description: "Daily core sync routine",
    category: "work",
    completed: true,
  },
  {
    id: "event_2",
    title: "Arc Reactor Heat Sync Calibration",
    start: "2026-07-21T14:30",
    end: "2026-07-21T15:30",
    description: "Check isotope cooling cycle",
    category: "health",
    completed: false,
  },
  {
    id: "event_3",
    title: "Daisy Neural Framework Audit",
    start: "2026-07-21T16:30",
    end: "2026-07-21T17:30",
    description: "Synchronize Gemini vector updates",
    category: "ai",
    completed: false,
  }
];

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
  const [activeTab, setActiveTab] = useState<"home" | "daisy" | "music" | "notes" | "calendar" | "gmail">("home");
  const [initialPrompt, setInitialPrompt] = useState<string>("");

  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Music state — mirrors real Spotify playback (there is no local player).
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
      setNotes(INITIAL_PLAIN_NOTES);
      localStorage.setItem("daisy_plain_notes", JSON.stringify(INITIAL_PLAIN_NOTES));
    }
    
    if (savedEvents) {
      try { setEvents(JSON.parse(savedEvents)); } catch(e) {}
    } else {
      setEvents(INITIAL_PLAIN_EVENTS);
      localStorage.setItem("daisy_plain_events", JSON.stringify(INITIAL_PLAIN_EVENTS));
    }
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
          await spotify.playQuery(cmd.payload.query || "");
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

  // Keep the footer and Daisy's context in sync with what Spotify is actually
  // playing. Polls gently and stays quiet when Spotify isn't connected.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const np = await spotify.nowPlaying();
        if (cancelled) return;
        setPlaying(!!np?.playing);
        setActiveTrackTitle(np?.track?.name || "None");
      } catch {
        /* not connected or transient — leave the last known state alone */
      }
    };
    sync();
    const id = window.setInterval(sync, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ---- Global always-listening voice loop (works on any tab) --------------
  const [voiceListening, setVoiceListening] = useState<boolean>(false);
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState<string>("");
  const [voiceFinalTranscript, setVoiceFinalTranscript] = useState<string>("");
  const voiceHandlerRef = useRef<(text: string) => void>(() => {});

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

  // Handle a spoken utterance: log it, ask the LLM, speak + execute the reply.
  const handleVoiceMessage = async (text: string) => {
    const transcript = text.trim().replace(/\s+/g, " ");
    if (!transcript) return;

    voiceMessageInFlightRef.current = true;
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
    history = [...history, userMsg];
    localStorage.setItem("daisy_chat_history", JSON.stringify(history));
    window.dispatchEvent(new Event("daisy-chat-updated"));

    try {
      const context = {
        currentTime: new Date().toISOString(),
        notesCount: notes.length,
        eventsCount: events.length,
        currentTrack: activeTrackTitle,
      };
      const res = await fetch("/api/daisy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: transcript,
          history: history.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          context,
        }),
      });
      const data = await res.json();
      const replyText = data.text || "Sorry, I didn't catch that.";

      const daisyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "daisy",
        text: replyText,
        timestamp: new Date().toISOString(),
        commands: data.commands,
      };
      history = [...history, daisyMsg];
      localStorage.setItem("daisy_chat_history", JSON.stringify(history));
      window.dispatchEvent(new Event("daisy-chat-updated"));

      // Handing off to TTS: daisyVoice.isBusy() becomes true synchronously
      // inside speak(), so clearing these here leaves no gap for the mic to
      // sneak in a new recording before playback actually starts.
      voiceMessageInFlightRef.current = false;
      setVoiceProcessing(false);
      daisyVoice.speak(replyText);
      if (Array.isArray(data.commands)) {
        data.commands.forEach((cmd: any) => handleExecuteCommand(cmd));
      }
    } catch (err) {
      voiceMessageInFlightRef.current = false;
      setVoiceProcessing(false);
      daisyVoice.speak("Sorry, I couldn't reach the backend just now.");
    }
  };

  // --- Wake word ------------------------------------------------------------
  // Siri-style: the mic always captures, but Daisy stays asleep until she hears
  // "Hey Daisy". Once awake she listens for a request and, if none arrives,
  // goes back to sleep so ordinary conversation isn't sent to the LLM.
  const WAKE_WINDOW_MS = 8000;
  const wakeUntilRef = useRef(0);
  const [voiceAwake, setVoiceAwake] = useState(false);

  /**
   * Match "Daisy" at the start of an utterance, with an optional greeting, so
   * both "Daisy, play music" and "Hey Daisy, play music" wake her.
   *
   * Anchored to the start on purpose: matching her name anywhere would fire on
   * "I told Daisy about it". Whisper's initial_prompt biases toward the correct
   * spelling, but close variants still come back, so those are accepted too.
   */
  const WAKE_RE = /^\s*(?:\b(?:hey|hi|hello|ok(?:ay)?)\b[\s,]*)?\b(?:dais(?:y|ey|ie)|daizy|dazy|daysi)\b[\s,.!?-]*/i;

  /**
   * The command Daisy should act on, or null if she wasn't addressed.
   * Returns "" when the wake word was all that was said.
   */
  const extractCommand = (transcript: string, awake: boolean): string | null => {
    const match = transcript.match(WAKE_RE);
    if (match) return transcript.slice(match[0].length).trim();
    // Already awake: treat this as a follow-up in the same conversation.
    return awake ? transcript.trim() : null;
  };

  const handleSpokenTranscript = (raw: string) => {
    const text = (raw || "").trim().replace(/\s+/g, " ");
    if (!text) return;

    const awake = Date.now() < wakeUntilRef.current;
    const command = extractCommand(text, awake);

    if (command === null) {
      // Overheard speech that wasn't for Daisy — drop it without adding to the
      // chat history or waking her.
      setVoiceDraftTranscript("");
      return;
    }

    wakeUntilRef.current = Date.now() + WAKE_WINDOW_MS;
    setVoiceAwake(true);

    if (!command) {
      // Just the wake phrase — acknowledge and hold the window open, the way
      // Siri chimes and waits for what you actually wanted.
      setVoiceFinalTranscript(text);
      daisyVoice.speak("Yes?");
      return;
    }
    handleVoiceMessage(command);
  };

  // Let the awake window lapse so she stops answering undirected chatter.
  // The countdown is paused while she is mid-answer: the window is about how
  // long she waits for *you*, not a deadline on her own reply.
  useEffect(() => {
    if (!voiceAwake) return;
    const id = window.setInterval(() => {
      if (voiceProcessingRef.current || daisyVoice.isBusy()) {
        wakeUntilRef.current = Date.now() + WAKE_WINDOW_MS;
        return;
      }
      if (Date.now() >= wakeUntilRef.current) {
        setVoiceAwake(false);
        setVoiceDraftTranscript("");
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [voiceAwake]);

  // Keep the listener callback pointed at the latest handler (fresh state).
  useEffect(() => {
    voiceHandlerRef.current = handleSpokenTranscript;
  });

  // Shared listener wiring for both the manual toggle and the on-mount
  // auto-start below. isBlocked strictly gates the mic on the full pipeline
  // (transcribing -> LLM thinking -> TTS busy), not just "audio playing", so
  // capture never starts again until the current turn is fully answered.
  const buildListenHandlers = () => ({
    onTranscript: (t: string) => voiceHandlerRef.current(t),
    onPartialTranscript: (t: string) => setVoiceDraftTranscript(t),
    onState: (s: ListenState) => {
      if (s === "transcribing") setVoiceProcessing(true);
      else if (s === "listening" && !voiceMessageInFlightRef.current) setVoiceProcessing(false);
    },
    isBlocked: () => voiceProcessingRef.current || daisyVoice.isBusy(),
    onError: () => setVoiceListening(false),
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
    try {
      await daisyListener.start(buildListenHandlers());
      setVoiceListening(true);
      localStorage.setItem("daisy_always_listening", "true");
    } catch {
      setVoiceListening(false);
    }
  };

  // Always-listening is on by default (Daisy waits for your voice); stop on teardown.
  useEffect(() => {
    if (localStorage.getItem("daisy_always_listening") !== "false") {
      daisyListener
        .start(buildListenHandlers())
        .then(() => setVoiceListening(true))
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
              <span className="font-sans font-extrabold tracking-tight">Daisy • Rishi's Workspace 🌼</span>
            </div>
            <div className="w-px h-4 bg-zinc-200 hidden lg:block" />
            <div
              className="hidden lg:flex items-center gap-3 text-[10px] font-bold text-zinc-500"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("home")}>File</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("notes")}>Edit</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("daisy")}>Workspace</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("calendar")}>Window</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("music")}>Audio</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("daisy")}>Help</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-zinc-600">
            {/* Mic master switch. When on, Daisy waits for the wake word and
                only answers once she's been addressed. */}
            <button
              onClick={toggleVoiceListening}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title={
                !voiceListening
                  ? "Microphone off — click to let Daisy listen"
                  : voiceAwake
                  ? "Daisy is listening for your request"
                  : 'Say "Daisy" to wake her'
              }
              className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                !voiceListening
                  ? "bg-white/60 border-zinc-200 text-zinc-500 hover:bg-white"
                  : voiceAwake
                  ? "bg-emerald-500 border-emerald-600 text-white shadow-sm"
                  : "bg-white/70 border-emerald-300 text-emerald-700"
              }`}
            >
              {voiceListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              <span className="text-[10px] font-bold tracking-tight">
                {!voiceListening ? "Off" : voiceAwake ? "Listening…" : 'Say "Daisy"'}
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
                Are you sure you want to close Rishi's workspace? Any playing audio will stop.
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
