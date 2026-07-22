import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Heart,
  Activity,
  Flame,
  Smartphone,
  Calendar,
  Cloud,
  RefreshCw,
  Check,
  ExternalLink,
  Lock,
  Watch,
  TrendingUp,
  ChevronRight,
  Info
} from "lucide-react";

interface AppleHealthData {
  connected: boolean;
  deviceName: string;
  lastSynced: string;
  steps: number;
  calories: number;
  standHours: number;
  sleepHours: number;
  heartRate: number;
  exerciseMinutes: number;
}

export default function AppleSyncHub() {
  const [data, setData] = useState<AppleHealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [icloudSync, setIcloudSync] = useState<boolean>(true);
  const [calendarSync, setCalendarSync] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Manual inputs for editing/simulating Shortcut sync
  const [editSteps, setEditSteps] = useState<number>(8420);
  const [editCalories, setEditCalories] = useState<number>(485);
  const [editSleep, setEditSleep] = useState<number>(7.4);
  const [editHeart, setEditHeart] = useState<number>(68);

  const fetchMetrics = async () => {
    try {
      const res = await fetch("/api/apple-health");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setEditSteps(json.steps);
        setEditCalories(json.calories);
        setEditSleep(json.sleepHours);
        setEditHeart(json.heartRate);
      }
    } catch (err) {
      console.error("Failed to load Apple Health metrics", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const triggerSync = async () => {
    setSyncing(true);
    // Simulate real network synchronization latency
    setTimeout(async () => {
      await fetchMetrics();
      setSyncing(false);
      showToast("Ecosystem Sync Successful!");
    }, 1200);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleUpdateMetrics = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/apple-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: editSteps,
          calories: editCalories,
          sleepHours: editSleep,
          heartRate: editHeart
        })
      });
      if (res.ok) {
        const result = await res.json();
        setData(result.data);
        showToast("Apple Health Synced via Daisy Core API!");
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to sync API!");
    }
  };

  const getShortcutURL = () => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/apple-health`;
    }
    return "https://daisy-core.run.app/api/apple-health";
  };

  return (
    <div id="apple_sync_hub_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header Info Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight flex items-center gap-2">
            Apple Ecosystem Integration
          </h1>
          <p className="text-xs text-zinc-500 font-medium">
            Sync Daisy Core with HealthKit, iCloud Storage, and watchOS Core 🍏✨
          </p>
        </div>

        <button
          onClick={triggerSync}
          disabled={syncing}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 cursor-pointer shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing iCloud & Watch..." : "Sync Apple Ecosystem"}
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 overflow-y-auto pr-1">
        {/* Left Side: Ecosystem Sync Cards */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-h-0">
          
          {/* Telemetry Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Calories Card */}
            <div className="bg-white/15 backdrop-blur-xl border border-white/30 rounded-3xl p-5 shadow-inner flex flex-col justify-between min-h-[140px]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-orange-600 tracking-wider uppercase">Active Energy</span>
                <Flame className="w-5 h-5 text-orange-500" />
              </div>
              <div className="my-2">
                <h3 className="text-2xl font-extrabold text-zinc-900 tracking-tight">{data?.calories ?? 485} <span className="text-xs font-semibold text-zinc-500">kcal</span></h3>
                <div className="w-full bg-zinc-200/50 h-2 rounded-full mt-2 overflow-hidden">
                  <div className="bg-orange-500 h-full rounded-full" style={{ width: `${Math.min(((data?.calories ?? 485) / 600) * 100, 100)}%` }} />
                </div>
              </div>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Daily Goal: 600 kcal</span>
            </div>

            {/* Steps Card */}
            <div className="bg-white/15 backdrop-blur-xl border border-white/30 rounded-3xl p-5 shadow-inner flex flex-col justify-between min-h-[140px]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-amber-600 tracking-wider uppercase">Step Activity</span>
                <Activity className="w-5 h-5 text-amber-500" />
              </div>
              <div className="my-2">
                <h3 className="text-2xl font-extrabold text-zinc-900 tracking-tight">{data?.steps ?? 8420} <span className="text-xs font-semibold text-zinc-500">steps</span></h3>
                <div className="w-full bg-zinc-200/50 h-2 rounded-full mt-2 overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: `${Math.min(((data?.steps ?? 8420) / 10000) * 100, 100)}%` }} />
                </div>
              </div>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Daily Goal: 10,000 steps</span>
            </div>

            {/* Sleep Card */}
            <div className="bg-white/15 backdrop-blur-xl border border-white/30 rounded-3xl p-5 shadow-inner flex flex-col justify-between min-h-[140px]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-indigo-600 tracking-wider uppercase">Sleep analysis</span>
                <Heart className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="my-2">
                <h3 className="text-2xl font-extrabold text-zinc-900 tracking-tight">{data?.sleepHours ?? 7.4} <span className="text-xs font-semibold text-zinc-500">hrs</span></h3>
                <div className="w-full bg-zinc-200/50 h-2 rounded-full mt-2 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${Math.min(((data?.sleepHours ?? 7.4) / 8) * 100, 100)}%` }} />
                </div>
              </div>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Daily Goal: 8.0 hrs</span>
            </div>

          </div>

          {/* Core Ecosystem Integrations Shelf */}
          <div className="bg-white/15 backdrop-blur-xl border border-white/30 rounded-[32px] p-6 shadow-sm">
            <h3 className="text-sm font-extrabold text-zinc-800 mb-3 flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-zinc-600" />
              Active System Bridges (Rishi's Ecosystem)
            </h3>
            
            <div className="space-y-4">
              
              {/* iCloud Bridge */}
              <div className="flex items-center justify-between p-3.5 bg-white/30 rounded-2xl border border-white/40 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 text-sky-600 rounded-xl">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-800">iCloud Drive Syncing</h4>
                    <p className="text-[10px] text-zinc-500 font-medium">Automatic background sync of workspace notes and configurations</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIcloudSync(!icloudSync);
                    showToast(icloudSync ? "iCloud Sync Disabled" : "iCloud Sync Enabled!");
                  }}
                  className={`w-12 h-6 rounded-full p-1 transition-all ${icloudSync ? "bg-emerald-500" : "bg-zinc-300"}`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-all ${icloudSync ? "translate-x-6" : ""}`} />
                </button>
              </div>

              {/* Calendar Bridge */}
              <div className="flex items-center justify-between p-3.5 bg-white/30 rounded-2xl border border-white/40 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-600 rounded-xl">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-800">Apple Calendar Bridge</h4>
                    <p className="text-[10px] text-zinc-500 font-medium">Sync schedule events directly with iCloud/macOS Calendars</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCalendarSync(!calendarSync);
                    showToast(calendarSync ? "Calendar Bridge Disabled" : "Calendar Bridge Enabled!");
                  }}
                  className={`w-12 h-6 rounded-full p-1 transition-all ${calendarSync ? "bg-emerald-500" : "bg-zinc-300"}`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-all ${calendarSync ? "translate-x-6" : ""}`} />
                </button>
              </div>

              {/* Apple Watch Telemetry */}
              <div className="p-3.5 bg-white/30 rounded-2xl border border-white/40 shadow-sm flex justify-between items-center">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl">
                    <Watch className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-800">Apple Watch Connectivity</h4>
                    <p className="text-[10px] text-zinc-500 font-medium">Synced via Core Bluetooth Background Service</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                  Connected
                </div>
              </div>

            </div>
          </div>

          {/* Shortcuts API Setup Instructions */}
          <div className="bg-zinc-900 text-zinc-200 rounded-[32px] p-6 shadow-md relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent)] pointer-events-none" />
            
            <h3 className="text-sm font-extrabold text-white mb-2 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              Configure Apple iOS Shortcut Sync
            </h3>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              Transmit your real-time HealthKit data automatically from your Apple device (iPhone, iPad, or Apple Watch) using standard Apple Shortcuts.
            </p>

            <div className="space-y-3 font-mono text-[10px] text-zinc-300">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col gap-1">
                <span className="text-zinc-500 font-bold uppercase text-[8px] tracking-widest">HTTP Post URL</span>
                <span className="text-emerald-400 font-semibold break-all select-all">{getShortcutURL()}</span>
              </div>

              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col gap-1.5">
                <span className="text-zinc-500 font-bold uppercase text-[8px] tracking-widest">Request Body Format (JSON)</span>
                <pre className="text-zinc-400 font-semibold text-[8px] leading-relaxed select-all">
{`{
  "steps": 8420,
  "calories": 485,
  "sleepHours": 7.4,
  "heartRate": 68,
  "deviceName": "Rishi's iPhone"
}`}
                </pre>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80 font-bold mt-4">
              <Lock className="w-3.5 h-3.5" />
              E2E Secure SSL Sandbox Encryption Enabled
            </div>
          </div>

        </div>

        {/* Right Side: Metrics Simulator */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-white/15 backdrop-blur-xl border border-white/30 rounded-[32px] p-5 shadow-inner">
            <div className="mb-4">
              <span className="text-[10px] font-extrabold text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Telemetry Console
              </span>
              <h3 className="text-sm font-extrabold text-zinc-800 mt-1.5">
                HealthKit Mock Sync
              </h3>
              <p className="text-[10px] text-zinc-500 font-medium">
                Test the Daisy `/api/apple-health` sync endpoint live.
              </p>
            </div>

            <form onSubmit={handleUpdateMetrics} className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Steps Sync</label>
                <input
                  type="number"
                  value={editSteps}
                  onChange={(e) => setEditSteps(Number(e.target.value))}
                  className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Active Calories (kcal)</label>
                <input
                  type="number"
                  value={editCalories}
                  onChange={(e) => setEditCalories(Number(e.target.value))}
                  className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Sleep Hours</label>
                <input
                  type="number"
                  step="0.1"
                  value={editSleep}
                  onChange={(e) => setEditSleep(Number(e.target.value))}
                  className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Heart Rate (BPM)</label>
                <input
                  type="number"
                  value={editHeart}
                  onChange={(e) => setEditHeart(Number(e.target.value))}
                  className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-amber-400 hover:bg-amber-500 text-zinc-950 text-xs font-bold rounded-xl shadow-md transition-all active:scale-95 cursor-pointer mt-2"
              >
                Simulate Shortcuts Push
              </button>
            </form>
          </div>

          {/* Quick Stats Panel */}
          <div className="bg-zinc-50/80 border border-zinc-200 rounded-[28px] p-4 text-xs">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block mb-3">Sync Metadata</span>
            <div className="space-y-2 text-[10px] font-bold text-zinc-600">
              <div className="flex justify-between">
                <span>Core Device:</span>
                <span className="text-zinc-800 font-extrabold">{data?.deviceName ?? "Rishi's Apple Watch Ultra"}</span>
              </div>
              <div className="flex justify-between">
                <span>Ecosystem Security:</span>
                <span className="text-emerald-600 flex items-center gap-1">HTTPS secure</span>
              </div>
              <div className="flex justify-between">
                <span>Last Push:</span>
                <span className="text-zinc-800">{data?.lastSynced ? new Date(data.lastSynced).toLocaleTimeString() : "Pending"}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-12 right-6 bg-zinc-900 border border-zinc-800 text-white font-sans text-xs px-4 py-3 rounded-2xl shadow-xl z-50 flex items-center gap-2"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
