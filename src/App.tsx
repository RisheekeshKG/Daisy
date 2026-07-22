import React, { useState, useEffect, useRef } from "react";
import { Bot, Music, FileText, Calendar as CalendarIcon, Radio, Laptop, Plus, Search, Compass, LayoutGrid as Grid, Clock, Mail, Heart, Mic, MicOff } from "lucide-react";
import { Note, CalendarEvent, ChatMessage } from "./types";
import { daisyVoice } from "./lib/voice";
import { daisyListener, type ListenState } from "./lib/listen";
import { spotify, SpotifyRequestError } from "./lib/spotify";
import JarvisAgent, { DaisyFlower, YellowTie, DaisyMascotAvatar } from "./components/JarvisAgent";
import MediaSpotify from "./components/MediaSpotify";
import WorkspaceNotion from "./components/WorkspaceNotion";
import CalendarSchedule from "./components/CalendarSchedule";
import DaisyDashboard from "./components/DaisyDashboard";
import WorkspaceGmail from "./components/WorkspaceGmail";
import AppleSyncHub from "./components/AppleSyncHub";
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
    content: "# Workspace Security Directive\n\nJARVIS is monitoring all offline boundaries.\nAll notes inside this Notion workspace are designed to be client-side compiled.\n\n### Task Sync:\nEnsure daily study limits are scheduled to avoid bio-resonance fatigue.",
    tags: ["security", "jarvis"],
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
    title: "JARVIS Neural Framework Audit",
    start: "2026-07-21T16:30",
    end: "2026-07-21T17:30",
    description: "Synchronize Gemini vector updates",
    category: "ai",
    completed: false,
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<"home" | "jarvis" | "music" | "notes" | "calendar" | "gmail">("home");
  const [initialPrompt, setInitialPrompt] = useState<string>("");

  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Music state — mirrors real Spotify playback (there is no local player).
  const [playing, setPlaying] = useState<boolean>(false);
  const [activeTrackTitle, setActiveTrackTitle] = useState<string>("None");

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
    const savedNotes = localStorage.getItem("jarvis_plain_notes");
    const savedEvents = localStorage.getItem("jarvis_plain_events");
    
    if (savedNotes) {
      try { setNotes(JSON.parse(savedNotes)); } catch(e) {}
    } else {
      setNotes(INITIAL_PLAIN_NOTES);
      localStorage.setItem("jarvis_plain_notes", JSON.stringify(INITIAL_PLAIN_NOTES));
    }
    
    if (savedEvents) {
      try { setEvents(JSON.parse(savedEvents)); } catch(e) {}
    } else {
      setEvents(INITIAL_PLAIN_EVENTS);
      localStorage.setItem("jarvis_plain_events", JSON.stringify(INITIAL_PLAIN_EVENTS));
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
    localStorage.setItem("jarvis_plain_notes", JSON.stringify(updated));
  };

  const handleDeleteNote = async (id: string) => {
    const updated = notes.filter(n => n.id !== id);
    setNotes(updated);
    if (selectedNoteId === id) setSelectedNoteId(null);
    localStorage.setItem("jarvis_plain_notes", JSON.stringify(updated));
  };

  const handleUpdateNote = async (updatedNote: Note) => {
    const updated = notes.map(n => n.id === updatedNote.id ? updatedNote : n);
    setNotes(updated);
    localStorage.setItem("jarvis_plain_notes", JSON.stringify(updated));
  };

  // Calendar Event handlers
  const handleAddEvent = async (newEventData: Omit<CalendarEvent, "id">) => {
    const newEvent: CalendarEvent = {
      ...newEventData,
      id: crypto.randomUUID()
    };
    const updated = [...events, newEvent];
    setEvents(updated);
    localStorage.setItem("jarvis_plain_events", JSON.stringify(updated));
  };

  const handleDeleteEvent = async (id: string) => {
    const updated = events.filter(e => e.id !== id);
    setEvents(updated);
    localStorage.setItem("jarvis_plain_events", JSON.stringify(updated));
  };

  const handleToggleComplete = async (id: string) => {
    const updated = events.map(e => e.id === id ? { ...e, completed: !e.completed } : e);
    setEvents(updated);
    localStorage.setItem("jarvis_plain_events", JSON.stringify(updated));
  };

  const handleUpdateEvent = async (updatedEvent: CalendarEvent) => {
    const updated = events.map(e => e.id === updatedEvent.id ? updatedEvent : e);
    setEvents(updated);
    localStorage.setItem("jarvis_plain_events", JSON.stringify(updated));
  };

  const handlePlayingChange = (isPlaying: boolean) => {
    setPlaying(isPlaying);
  };

  // Execute Neural Automation Commands returned by JARVIS
  const handleExecuteCommand = async (cmd: { type: string; payload: any }) => {
    console.log("JARVIS automation command:", cmd);
    switch (cmd.type) {
      case "ADD_EVENT":
        await handleAddEvent({
          title: cmd.payload.title || "Scheduled JARVIS Event",
          start: cmd.payload.start || new Date().toISOString().substring(0, 16),
          end: cmd.payload.end || new Date(Date.now() + 3600000).toISOString().substring(0, 16),
          description: cmd.payload.description || "Synthesized proactively by JARVIS Sentinel system",
          category: "ai",
          completed: false,
        });
        break;
      case "ADD_NOTE":
        await handleAddNote({
          title: cmd.payload.title || "JARVIS Memo Draft",
          content: cmd.payload.content || "# Memo\nProactively derived by neural workspace.",
          tags: cmd.payload.tags || ["jarvis"],
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
    setActiveTab("jarvis");
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
      history = JSON.parse(localStorage.getItem("jarvis_chat_history") || "[]");
    } catch {}

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: transcript,
      timestamp: new Date().toISOString(),
    };
    history = [...history, userMsg];
    localStorage.setItem("jarvis_chat_history", JSON.stringify(history));
    window.dispatchEvent(new Event("daisy-chat-updated"));

    try {
      const context = {
        currentTime: new Date().toISOString(),
        notesCount: notes.length,
        eventsCount: events.length,
        currentTrack: activeTrackTitle,
      };
      const res = await fetch("/api/jarvis", {
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

      const jarvisMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "jarvis",
        text: replyText,
        timestamp: new Date().toISOString(),
        commands: data.commands,
      };
      history = [...history, jarvisMsg];
      localStorage.setItem("jarvis_chat_history", JSON.stringify(history));
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

  // Keep the listener callback pointed at the latest handler (fresh state).
  useEffect(() => {
    voiceHandlerRef.current = handleVoiceMessage;
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
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("jarvis")}>Workspace</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("calendar")}>Window</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("music")}>Audio</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("apple")}>Ecosystem</span>
              <span className="hover:text-amber-600 transition-colors cursor-pointer" onClick={() => setActiveTab("jarvis")}>Help</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-zinc-600">
            {/* Global always-listening voice toggle */}
            <button
              onClick={toggleVoiceListening}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title={voiceListening ? "Daisy is listening — click to stop" : "Enable always-listening voice"}
              className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                voiceListening
                  ? "bg-emerald-500 border-emerald-600 text-white shadow-sm"
                  : "bg-white/60 border-zinc-200 text-zinc-500 hover:bg-white"
              }`}
            >
              {voiceListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
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
                  setActiveTab("jarvis");
                }}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer relative shrink-0 ${
                  activeTab === "jarvis" ? "scale-105 ring-2 ring-amber-400/40 shadow-md" : "opacity-70 hover:opacity-100 hover:scale-105"
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

              {/* Circle 7: Apple Ecosystem */}
              <button
                onClick={() => {
                  setActiveTab("apple");
                }}
                className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                  activeTab === "apple" ? "bg-white shadow-md border-amber-300 ring-2 ring-amber-300/20 text-amber-600" : "bg-white/40 hover:bg-white/80 border-zinc-200 text-zinc-600"
                }`}
                title="Apple Ecosystem Sync"
              >
                <Heart className="w-4 h-4" />
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
                {activeTab === "jarvis" && (
                  <JarvisAgent
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
                  />
                )}
                {activeTab === "gmail" && (
                  <WorkspaceGmail />
                )}
                {activeTab === "apple" && (
                  <AppleSyncHub />
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
