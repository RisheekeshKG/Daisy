import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, User, Sparkles, Terminal, Activity, ShieldAlert, Volume2, VolumeX, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ChatMessage } from "../types";
import { daisyVoice } from "../lib/voice";

export function DaisyFlower({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center ${className} relative shrink-0`}>
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.15)]">
        {/* 12 gorgeous white petals with soft gray borders */}
        <circle cx="50" cy="18" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="50" cy="82" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="18" cy="50" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="82" cy="50" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        
        {/* Diagonal petals */}
        <circle cx="27" cy="27" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="73" cy="73" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="27" cy="73" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="73" cy="27" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        
        {/* Intermediate petals */}
        <circle cx="38" cy="19" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="62" cy="81" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="19" cy="38" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="81" cy="62" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        
        <circle cx="62" cy="19" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="38" cy="81" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="81" cy="38" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />
        <circle cx="19" cy="62" r="10" fill="white" stroke="#e4e4e7" strokeWidth="1" />

        {/* Center disk - rich golden yellow daisy core */}
        <circle cx="50" cy="50" r="18" fill="#eab308" />
        <circle cx="50" cy="50" r="15" fill="#facc15" />
        {/* Small details on disk */}
        <circle cx="46" cy="46" r="2" fill="#ca8a04" />
        <circle cx="54" cy="54" r="2" fill="#ca8a04" />
        <circle cx="54" cy="46" r="2" fill="#ca8a04" />
        <circle cx="46" cy="54" r="2" fill="#ca8a04" />
      </svg>
    </span>
  );
}

export function YellowTie({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center ${className} relative shrink-0`}>
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.15)]">
        {/* Cute Bow Tie / Ribbon design */}
        {/* Left ribbon loop */}
        <path d="M 50 50 Q 25 20 20 40 Q 15 60 50 50" fill="#fbbf24" stroke="#d97706" strokeWidth="2.5" strokeLinejoin="round" />
        {/* Right ribbon loop */}
        <path d="M 50 50 Q 75 20 80 40 Q 85 60 50 50" fill="#fbbf24" stroke="#d97706" strokeWidth="2.5" strokeLinejoin="round" />
        {/* Left ribbon tail */}
        <path d="M 45 52 L 25 80 L 35 82 L 48 55 Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
        {/* Right ribbon tail */}
        <path d="M 55 52 L 75 80 L 65 82 L 52 55 Z" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
        {/* Center knot */}
        <circle cx="50" cy="50" r="10" fill="#f59e0b" stroke="#b45309" strokeWidth="2.5" />
      </svg>
    </span>
  );
}

export function DaisyMascotAvatar({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <div className={`relative ${className} flex items-center justify-center shrink-0`}>
      {/* Mini Robot Head body */}
      <div className="w-full h-[80%] bg-white border border-zinc-250 rounded-lg relative flex items-center justify-center shadow-sm">
        

        
        {/* Flower on top right */}
        <div className="absolute -top-2 -right-1 z-10">
          <DaisyFlower className="w-4 h-4" />
        </div>
        
        {/* Bow tie on top left */}
        <div className="absolute -top-2 -left-1 z-10">
          <YellowTie className="w-4 h-4" />
        </div>
        
        {/* Cute digital screen */}
        <div className="w-[85%] h-[80%] bg-zinc-900 rounded-md flex items-center justify-center relative overflow-hidden">
          {/* Eyes showing cute static glowing dots */}
          <div className="flex gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_2px_#fbbf24]" />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_2px_#fbbf24]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DigitalMascotFace({ expression }: { expression: string }) {
  const size = "w-full h-full";
  switch (expression) {
    case ">.<":
    case ">_&lt;":
    case ">_<":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[6] stroke-linecap-round`}>
          {/* Left squint: > */}
          <path d="M 22 12 L 35 20 L 22 28" />
          {/* Right squint: < */}
          <path d="M 78 12 L 65 20 L 78 28" />
          {/* Mouth: . */}
          <circle cx="50" cy="22" r="4" className="fill-current stroke-none" />
        </svg>
      );
    case "^-^":
    case "^_^":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[6] stroke-linecap-round`}>
          {/* Left happy curve: ^ */}
          <path d="M 20 25 Q 32 10 44 25" />
          {/* Right happy curve: ^ */}
          <path d="M 56 25 Q 68 10 80 25" />
        </svg>
      );
    case "*.*":
    case "*_*":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-current`}>
          {/* Left star */}
          <path d="M 30 10 L 33 17 L 40 17 L 35 22 L 37 29 L 30 25 L 23 29 L 25 22 L 20 17 L 27 17 Z" className="filter drop-shadow-[0_0_3px_#fbbf24]" />
          {/* Right star */}
          <path d="M 70 10 L 73 17 L 80 17 L 75 22 L 77 29 L 70 25 L 63 29 L 65 22 L 60 17 L 67 17 Z" className="filter drop-shadow-[0_0_3px_#fbbf24]" />
          {/* Mouth */}
          <path d="M 46 24 Q 50 28 54 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "O.O":
    case "0_0":
    case "o_o":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[5]`}>
          {/* Left big eye circle */}
          <circle cx="30" cy="20" r="10" className="stroke-current fill-amber-400/10" />
          <circle cx="30" cy="20" r="3" className="fill-current stroke-none" />
          {/* Right big eye circle */}
          <circle cx="70" cy="20" r="10" className="stroke-current fill-amber-400/10" />
          <circle cx="70" cy="20" r="3" className="fill-current stroke-none" />
          {/* Mouth */}
          <circle cx="50" cy="24" r="2.5" className="fill-current stroke-none" />
        </svg>
      );
    case ";-;":
    case "T_T":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[6] stroke-linecap-round`}>
          {/* Left sad slant */}
          <path d="M 22 15 L 34 15" />
          {/* Right sad slant */}
          <path d="M 66 15 L 78 15" />
          {/* Left tears */}
          <path d="M 28 18 L 28 32" className="stroke-cyan-400 stroke-[4] animate-pulse" />
          {/* Right tears */}
          <path d="M 72 18 L 72 32" className="stroke-cyan-400 stroke-[4] animate-pulse" />
          {/* Mouth */}
          <path d="M 45 28 Q 50 22 55 28" strokeWidth="4" />
        </svg>
      );
    case "u_u":
    case "-_-":
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[6] stroke-linecap-round`}>
          {/* Left sleeping curve */}
          <path d="M 20 18 Q 30 28 40 18" />
          {/* Right sleeping curve */}
          <path d="M 60 18 Q 70 28 80 18" />
        </svg>
      );
    case "._.":
    default:
      return (
        <svg viewBox="0 0 100 40" className={`${size} text-amber-400 fill-none stroke-current stroke-[6] stroke-linecap-round`}>
          {/* Left bar */}
          <path d="M 20 20 L 36 20" />
          {/* Right bar */}
          <path d="M 64 20 L 80 20" />
          {/* Mouth */}
          <circle cx="50" cy="20" r="3" className="fill-current stroke-none" />
        </svg>
      );
  }
}

const getSentimentExpression = (text: string, isThinking: boolean): string => {
  if (isThinking) return "O.O";
  
  const lower = text.toLowerCase();
  
  if (
    lower.includes("yay") || 
    lower.includes("hooray") || 
    lower.includes("excited") || 
    lower.includes("success") || 
    lower.includes("complete") || 
    lower.includes("done!") || 
    lower.includes("victory") ||
    lower.includes("!!!")
  ) {
    return ">.<";
  }
  
  if (
    lower.includes("happy") || 
    lower.includes("beautiful") || 
    lower.includes("sweet") || 
    lower.includes("wonderful") || 
    lower.includes("delightful") || 
    lower.includes("love") || 
    lower.includes("perfect") || 
    lower.includes("cute") || 
    lower.includes("glad") || 
    lower.includes("smile") || 
    lower.includes("good") || 
    lower.includes("welcome") ||
    lower.includes("hello") ||
    lower.includes("hi") ||
    lower.includes("🌼") ||
    lower.includes("✨")
  ) {
    return "^-^";
  }
  
  if (
    lower.includes("sorry") || 
    lower.includes("sad") || 
    lower.includes("unfortunately") || 
    lower.includes("fail") || 
    lower.includes("error") || 
    lower.includes("missing") || 
    lower.includes("conflict") || 
    lower.includes("bad") || 
    lower.includes("cry") ||
    lower.includes("offline")
  ) {
    return ";-;";
  }
  
  if (
    lower.includes("star") ||
    lower.includes("genius") ||
    lower.includes("amazing") ||
    lower.includes("awesome") ||
    lower.includes("incredible") ||
    lower.includes("fascinating") ||
    lower.includes("unbelievable") ||
    lower.includes("magic")
  ) {
    return "*.*";
  }
  
  if (
    lower.includes("tired") ||
    lower.includes("sleep") ||
    lower.includes("night") ||
    lower.includes("exhausted") ||
    lower.includes("rest")
  ) {
    return "u_u";
  }
  
  if (
    lower.includes("whoa") ||
    lower.includes("wow") ||
    lower.includes("shock") ||
    lower.includes("really?") ||
    lower.includes("seriously")
  ) {
    return "O.O";
  }
  
  return "^-^";
};

interface DaisyAgentProps {
  onExecuteCommand: (command: { type: string; payload: any }) => void;
  notesCount: number;
  eventsCount: number;
  currentTrackTitle: string;
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
}

export default function DaisyAgent({
  onExecuteCommand,
  notesCount,
  eventsCount,
  currentTrackTitle,
  initialPrompt,
  onClearInitialPrompt,
}: DaisyAgentProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("daisy_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return [
      {
        id: "welcome",
        role: "daisy",
        text: "Hi, I'm Daisy. Everything's set up and ready. What do you need?",
        timestamp: new Date().toISOString(),
      },
    ];
  });

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [mascotExpression, setMascotExpression] = useState<string>("^-^");
  const [expressionOverride, setExpressionOverride] = useState<string | null>(null);

  const [voiceEnabled, setVoiceEnabled] = useState(daisyVoice.getEnabled());
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Refresh the chat when the global voice loop appends to the shared history.
  useEffect(() => {
    const reload = () => {
      try {
        const saved = localStorage.getItem("daisy_chat_history");
        if (saved) setMessages(JSON.parse(saved));
      } catch {}
    };
    window.addEventListener("daisy-chat-updated", reload);
    return () => window.removeEventListener("daisy-chat-updated", reload);
  }, []);

  useEffect(() => {
    daisyVoice.setSpeakingStateCallback((speaking) => {
      setIsSpeaking(speaking);
    });
    return () => {
      daisyVoice.setSpeakingStateCallback(null);
    };
  }, []);

  const lastMsg = messages[messages.length - 1];

  useEffect(() => {
    if (isThinking) {
      setMascotExpression("O.O");
    } else if (lastMsg) {
      const sentiment = getSentimentExpression(lastMsg.text, isThinking);
      setMascotExpression(sentiment);
    } else {
      setMascotExpression("^-^");
    }
  }, [messages, isThinking]);

  useEffect(() => {
    if (expressionOverride) {
      const timer = setTimeout(() => {
        setExpressionOverride(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [expressionOverride]);

  useEffect(() => {
    localStorage.setItem("daisy_chat_history", JSON.stringify(messages));
    // Scroll only the chat container (not the page). scrollIntoView() walks up
    // every scrollable ancestor — including the overflow-hidden app frame —
    // which would shove the whole window up. Setting scrollTop stays local.
    const c = chatScrollRef.current;
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      handleSendMessage(initialPrompt);
      if (onClearInitialPrompt) {
        onClearInitialPrompt();
      }
    }
  }, [initialPrompt]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    if (!textToSend) setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    try {
      // Build history for context (keep last 6 messages)
      const chatHistoryForAPI = messages.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const context = {
        currentTime: new Date().toISOString(),
        notesCount,
        eventsCount,
        currentTrack: currentTrackTitle || "None",
      };

      const response = await fetch("/api/daisy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: chatHistoryForAPI,
          context,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to reach the Daisy server.");
      }

      const data = await response.json();

      const daisyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "daisy",
        text: data.text || "Apologies Sir, my cybernetic pathways encountered a momentary desync.",
        timestamp: new Date().toISOString(),
        commands: data.commands,
      };

      setMessages((prev) => [...prev, daisyMsg]);
      daisyVoice.speak(daisyMsg.text);

      // Execute commands returned by Daisy
      if (data.commands && Array.isArray(data.commands)) {
        data.commands.forEach((cmd: any) => {
          onExecuteCommand(cmd);
        });
      }
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "daisy",
        text: "I am running in offline local containment, Sir. I can help organize notes, play ambient tracks, and manage schedule items locally directly.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      daisyVoice.speak(errorMsg.text);
    } finally {
      setIsThinking(false);
    }
  };

  const suggestions = [
    "Schedule a study block tomorrow at 4 PM 🌸",
    "Write a beautiful note about project goals 📝",
    "Play my favorite focus stream 🎵",
    "Do I have any calendar events?",
  ];

  return (
    <div id="daisy_agent_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header Info Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-md animate-pulse" />
            <DaisyMascotAvatar className="w-12 h-12" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">
              Daisy AI Core
            </h1>
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              <span>Sweet Supportive Daily Orchestration ✨</span>
            </div>
          </div>
        </div>

        {/* Neural Telemetry */}
        <div className="flex items-center gap-4 bg-zinc-50 border border-zinc-200 px-4 py-2 rounded-2xl text-xs shadow-sm">
          <div className="flex flex-col">
            <span className="text-zinc-400 font-bold">Workspace Notes</span>
            <span className="font-extrabold text-zinc-800">{notesCount} active items</span>
          </div>
          <div className="w-px h-6 bg-zinc-200" />
          <div className="flex flex-col">
            <span className="text-zinc-400 font-bold">Schedule Events</span>
            <span className="font-extrabold text-zinc-800">{eventsCount} logged</span>
          </div>
          <div className="w-px h-6 bg-zinc-200" />
          <div className="flex flex-col">
            <span className="text-zinc-400 font-bold">E2E Sync</span>
            <span className="font-extrabold text-emerald-600 flex items-center gap-1">
              Active
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        {/* Left Side: Daisy Interactive Robot Mascot */}
        <div className="lg:col-span-4 flex flex-col items-center justify-between bg-zinc-50/80 border border-zinc-200/60 rounded-[28px] p-5 relative overflow-hidden shadow-inner min-h-[360px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.06),transparent)] pointer-events-none" />
          
          {/* Section Heading */}
          <div className="text-center z-10 w-full">
            <span className="text-[10px] font-extrabold tracking-widest text-amber-600 bg-amber-100/60 px-2.5 py-1 rounded-full uppercase">
              Daisy Interactive Mascot
            </span>
          </div>

          {/* Interactive Bouncing Mascot Container */}
          <motion.div 
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="relative flex flex-col items-center justify-center my-4 z-10 cursor-pointer"
            title="Click to tickle Daisy! ✨"
            onClick={() => {
              const funExprs = [">.<", "*.*", "O.O", "^-^", "._.", ";-;", "u_u"];
              const randomExpr = funExprs[Math.floor(Math.random() * funExprs.length)];
              setExpressionOverride(randomExpr);
            }}
          >
            {/* Robot Head */}
            <div className="w-36 h-28 bg-white border-[3px] border-zinc-200 rounded-[32px] relative flex items-center justify-center shadow-md transition-all duration-300 hover:border-amber-300 hover:shadow-lg">
              
              

              
              {/* White Daisy Flower on top-right side (no spinning!) */}
              <div className="absolute -top-5 -right-3 z-20">
                <DaisyFlower className="w-12 h-12" />
              </div>

              {/* Yellow Bow Tie on top-left side */}
              <div className="absolute -top-5 -left-3 z-20">
                <YellowTie className="w-12 h-12" />
              </div>

              {/* Ears/Side bolts */}
              <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-6 bg-zinc-300 rounded-l-md border-r-2 border-zinc-400" />
              <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-2.5 h-6 bg-zinc-300 rounded-r-md border-l-2 border-zinc-400" />

              {/* Face OLED Screen */}
              <div className="w-[85%] h-[80%] bg-zinc-900 rounded-[22px] flex flex-col items-center justify-center p-2 relative overflow-hidden border border-zinc-850 shadow-inner">
                
                {/* Blushing cheeks for happy states */}
                {["^-^", ">.<", "*.*"].includes(expressionOverride || mascotExpression) && (
                  <>
                    <div className="absolute bottom-4 left-3 w-3 h-1.5 bg-rose-400/40 rounded-full blur-[1px] animate-pulse" />
                    <div className="absolute bottom-4 right-3 w-3 h-1.5 bg-rose-400/40 rounded-full blur-[1px] animate-pulse" />
                  </>
                )}

                {/* Cyber grid lines details */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(18,18,18,0)_95%,rgba(251,191,36,0.04)_95%)] bg-[size:100%_6px] pointer-events-none" />

                {/* Digital Eyes Expression - custom glowing vectors */}
                <div className="w-[80%] h-[75%] flex items-center justify-center filter drop-shadow-[0_0_8px_rgba(251,191,36,0.7)] animate-pulse">
                  <DigitalMascotFace expression={expressionOverride || mascotExpression} />
                </div>
              </div>
            </div>

            {/* Little Robot Feet/Hoverpad */}
            <div className="flex gap-8 mt-1">
              <div className="w-4 h-2 bg-zinc-200 border border-zinc-300 rounded-b-full shadow-inner" />
              <div className="w-4 h-2 bg-zinc-200 border border-zinc-300 rounded-b-full shadow-inner" />
            </div>

            {/* Tap prompt */}
            <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider mt-2 bg-zinc-100 px-2 py-0.5 rounded-md hover:text-amber-600 transition-colors">
              Tap to tickle
            </span>
          </motion.div>

          {/* Status and Expressions Toolbar */}
          <div className="w-full text-center z-10">
            <p className="text-[10px] text-zinc-500 font-extrabold uppercase mt-1 flex items-center justify-center gap-1.5">
              {isThinking ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  <span>Thinking: O.O</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Reacted: {expressionOverride || mascotExpression}</span>
                </>
              )}
            </p>

            {/* Expression Toolbar Selector */}
            <div className="mt-3.5 border-t border-zinc-200/60 pt-3">
              <span className="text-[9px] text-zinc-400 font-extrabold uppercase tracking-widest block mb-2">
                Mascot Express Play
              </span>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[
                  { expr: ">.<", label: "Cute" },
                  { expr: "^-^", label: "Happy" },
                  { expr: "*.*", label: "Star" },
                  { expr: "O.O", label: "Whoa" },
                  { expr: ";-;", label: "Sob" },
                  { expr: "u_u", label: "Snooze" },
                ].map((item) => (
                  <button
                    key={item.expr}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpressionOverride(item.expr);
                    }}
                    className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-all cursor-pointer font-bold ${
                      (expressionOverride || mascotExpression) === item.expr
                        ? "bg-amber-100 border-amber-300 text-amber-700 shadow-sm"
                        : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                    }`}
                    title={`Make Daisy say: ${item.expr}`}
                  >
                    {item.expr}
                  </button>
                ))}
              </div>
            </div>

            {/* Energetic Speech Engine Controls */}
            <div className="mt-4 border-t border-zinc-200/60 pt-3.5 w-full">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[9px] text-zinc-400 font-extrabold uppercase tracking-widest">
                  Daisy Speech Engine
                </span>
                {isSpeaking && (
                  <span className="text-[8px] bg-amber-100 text-amber-700 font-mono px-1.5 py-0.5 rounded animate-pulse">
                    TALKING
                  </span>
                )}
              </div>
              
              <div className="bg-white border border-zinc-200/80 rounded-2xl p-3 shadow-sm flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = !voiceEnabled;
                        setVoiceEnabled(next);
                        daisyVoice.setEnabled(next);
                        if (next) {
                          daisyVoice.speak("Voice activated.", true);
                        }
                      }}
                      className={`p-2 rounded-xl border transition-all cursor-pointer ${
                        voiceEnabled 
                          ? "bg-amber-50 border-amber-200 text-amber-600 shadow-inner" 
                          : "bg-zinc-50 border-zinc-200 text-zinc-400"
                      }`}
                      title={voiceEnabled ? "Mute Daisy's voice" : "Unmute Daisy's voice"}
                    >
                      {voiceEnabled ? <Volume2 className="w-4 h-4 animate-bounce" /> : <VolumeX className="w-4 h-4" />}
                    </button>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-zinc-800">
                        {voiceEnabled ? "Daisy Girl Voice ON" : "Voice Muted"}
                      </span>
                      <span className="text-[8.5px] font-medium text-zinc-500 leading-none">
                        Warm neural voice · runs locally 🌸✨
                      </span>
                    </div>
                  </div>

                  {/* Pulsing Voice Equalizer when speaking */}
                  <div className="flex items-end gap-0.5 h-4 px-1.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={`w-0.75 bg-amber-500 rounded-full transition-all duration-300 ${
                          isSpeaking 
                            ? "h-3.5" 
                            : "h-1 opacity-45"
                        }`}
                        style={{
                          height: isSpeaking ? `${3 + (i * 2.5) % 11}px` : "4px",
                          animation: isSpeaking ? `pulse 0.6s infinite ease-in-out alternate` : undefined,
                          animationDelay: isSpeaking ? `${i * 100}ms` : undefined
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Quick Trigger Phrases */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      daisyVoice.speak("Hey, good to see you. Let's get to work.", true);
                    }}
                    className="text-[9.5px] bg-zinc-50 hover:bg-amber-50 border border-zinc-150 hover:border-amber-200 text-zinc-600 hover:text-amber-700 py-1 px-2 rounded-lg cursor-pointer transition-all text-center font-bold"
                  >
                    🌸 Yay, Greeting
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      daisyVoice.speak("All done, your workspace is synced and ready.", true);
                    }}
                    className="text-[9.5px] bg-zinc-50 hover:bg-amber-50 border border-zinc-150 hover:border-amber-200 text-zinc-600 hover:text-amber-700 py-1 px-2 rounded-lg cursor-pointer transition-all text-center font-bold"
                  >
                    🔒 Security Sync
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Simulated scanning line across left panel */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-400/15 to-transparent animate-[scan_3s_infinite_linear]" />
        </div>

        {/* Right Side: Chat Sandbox */}
        <div className="lg:col-span-8 flex flex-col bg-white border border-zinc-150 rounded-[28px] min-h-[450px] lg:h-full lg:min-h-0 shadow-sm justify-between">
          {/* Scrollable messages area */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`flex gap-3.5 max-w-[85%] ${
                    msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                  }`}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {msg.role === "user" ? (
                      <div className="w-8.5 h-8.5 rounded-xl border flex items-center justify-center shadow-sm bg-zinc-100 border-zinc-200 text-zinc-600">
                        <User className="w-4 h-4" />
                      </div>
                    ) : (
                      <DaisyMascotAvatar className="w-8.5 h-8.5" />
                    )}
                  </div>

                  {/* Bubble content */}
                  <div className="flex flex-col gap-1 w-full">
                    <div
                      className={`px-4 py-3 rounded-2xl border text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-amber-500/5 border-amber-200 text-zinc-800 rounded-tr-none shadow-sm"
                          : "bg-zinc-50 border-zinc-200/60 text-zinc-800 rounded-tl-none shadow-sm relative"
                      }`}
                    >
                      {msg.role === "daisy" ? (
                        <div className="relative group">
                          <p className="whitespace-pre-wrap font-medium pr-6">{msg.text}</p>
                          <button
                            onClick={() => daisyVoice.speak(msg.text, true)}
                            className="absolute right-0 top-0.5 p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-amber-500 transition-colors cursor-pointer"
                            title="Replay in Anime Voice"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap font-medium">{msg.text}</p>
                      )}
                      
                      {/* Interactive command display inside bubble */}
                      {msg.commands && msg.commands.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-zinc-200/60 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold font-mono text-amber-600">
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Executed Core Automations</span>
                          </div>
                          {msg.commands.map((cmd, i) => (
                            <div
                              key={i}
                              className="text-[11px] bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 font-mono text-zinc-700 flex justify-between items-center"
                            >
                              <span className="font-bold">{cmd.type}</span>
                              <span className="text-[9px] text-emerald-600 font-sans uppercase font-extrabold tracking-wider bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100">
                                Active
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-zinc-400 font-bold font-mono px-1">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </motion.div>
              ))}
              
              {isThinking && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3 max-w-[80%]"
                >
                  <DaisyMascotAvatar className="w-8.5 h-8.5" />
                  <div className="bg-zinc-50 border border-zinc-200 text-zinc-500 px-4 py-3 rounded-2xl rounded-tl-none text-xs flex items-center gap-2">
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.4s]" />
                    </span>
                    <span className="font-semibold text-zinc-500">Coordinating nice commands...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          {/* Quick Suggestions Shelf */}
          <div className="px-4 py-2 border-t border-zinc-150 flex gap-2 overflow-x-auto no-scrollbar scroll-smooth">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(s)}
                className="flex-shrink-0 text-[11px] bg-zinc-50 border border-zinc-200 hover:bg-amber-50 hover:border-amber-300 px-3 py-1.5 rounded-xl text-zinc-600 hover:text-amber-700 transition-all cursor-pointer whitespace-nowrap font-semibold"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Message input */}
          <div className="p-4 border-t border-zinc-150 flex gap-3 bg-zinc-50/50 rounded-b-[28px]">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendMessage();
              }}
              placeholder="Ask Daisy anything..."
              className="flex-1 bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-300/50 focus:border-amber-400 shadow-sm"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || isThinking}
              className="p-3 bg-gradient-to-r from-amber-400 to-rose-400 hover:from-amber-500 hover:to-rose-500 text-white rounded-2xl transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
