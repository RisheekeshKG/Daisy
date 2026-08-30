import React, { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, User, Mic, Link2, Check, Loader2 } from "lucide-react";
import { Card, CardBadge, CardTitle, CardBody, CardAction } from "./Card";
import { getUserName, setUserName as persistUserName } from "../lib/userName";
import { readVoicePref, writeVoicePref } from "../lib/voicePrefs";
import { daisyVoice } from "../lib/voice";
import { gcal } from "../lib/gcal";
import { gmail } from "../lib/gmail";
import { spotify } from "../lib/spotify";

interface SettingsPageProps {
  userName: string;
  onUserNameChange: (name: string) => void;
  /** Owned by App because the mic session lives there; Settings only reflects it. */
  alwaysListening: boolean;
  onToggleAlwaysListening: () => void;
}

/** A labelled on/off switch. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-zinc-900">{label}</p>
        <CardBody className="mt-0.5">{hint}</CardBody>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`shrink-0 mt-0.5 w-11 h-6 rounded-full border transition-all cursor-pointer relative ${
          checked
            ? "bg-amber-400 border-amber-500/40"
            : "bg-zinc-200 border-zinc-300 hover:bg-zinc-250"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

type ConnState = { loading: boolean; connected: boolean; detail: string; error: string };
const IDLE: ConnState = { loading: true, connected: false, detail: "", error: "" };

/** One integration row: live status plus the action that changes it. */
function ConnectionRow({
  name,
  state,
  onConnect,
  onDisconnect,
  busy,
  note,
}: {
  name: string;
  state: ConnState;
  onConnect?: () => void;
  onDisconnect?: () => void;
  busy: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-zinc-900">{name}</p>
          {state.loading ? (
            <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
          ) : state.connected ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700">
              <Check className="w-3.5 h-3.5" /> Connected
            </span>
          ) : (
            <span className="text-[12px] text-zinc-400">Not connected</span>
          )}
        </div>
        <CardBody className="mt-0.5">
          {state.error || state.detail || note || " "}
        </CardBody>
      </div>
      {onConnect || onDisconnect ? (
        <CardAction
          className="shrink-0"
          disabled={busy || state.loading}
          onClick={state.connected ? onDisconnect : onConnect}
        >
          {busy ? "Working…" : state.connected ? "Disconnect" : "Connect"}
        </CardAction>
      ) : null}
    </div>
  );
}

export default function SettingsPage({
  userName,
  onUserNameChange,
  alwaysListening,
  onToggleAlwaysListening,
}: SettingsPageProps) {
  // --- Profile ---
  const [nameDraft, setNameDraft] = useState(userName || getUserName());
  const [nameSaved, setNameSaved] = useState(false);
  useEffect(() => setNameDraft(userName), [userName]);

  const saveName = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = persistUserName(nameDraft);
    onUserNameChange(clean);
    setNameDraft(clean);
    setNameSaved(true);
    window.setTimeout(() => setNameSaved(false), 1800);
  };

  // --- Voice ---
  // Seeded from the engine where it owns the value, so Settings agrees with
  // whatever the dashboard's mute button last did.
  const [speakReplies, setSpeakReplies] = useState(() => daisyVoice.getEnabled());

  // --- Connections ---
  const [cal, setCal] = useState<ConnState>(IDLE);
  const [mail, setMail] = useState<ConnState>(IDLE);
  const [music, setMusic] = useState<ConnState>(IDLE);
  const [busy, setBusy] = useState<string>("");

  const refresh = useCallback(async () => {
    const [c, m, s] = await Promise.allSettled([gcal.status(), gmail.status(), spotify.status()]);

    if (c.status === "fulfilled") {
      setCal({
        loading: false,
        connected: c.value.connected,
        detail: c.value.account?.summary || (c.value.configured ? "" : "No Google client configured — see .env"),
        error: c.value.error || "",
      });
    } else setCal({ loading: false, connected: false, detail: "", error: "Couldn't reach the backend." });

    if (m.status === "fulfilled") {
      setMail({
        loading: false,
        connected: m.value.gmailAuthorized,
        // Gmail rides the Calendar grant; a token from before Gmail was added
        // is `connected` without being authorized for mail, which is worth
        // saying plainly rather than showing a dead Connect button.
        detail: m.value.connected && !m.value.gmailAuthorized
          ? "Reconnect Google Calendar to grant mail access."
          : "Shares the Google Calendar connection.",
        error: "",
      });
    } else setMail({ loading: false, connected: false, detail: "", error: "Couldn't reach the backend." });

    if (s.status === "fulfilled") {
      setMusic({
        loading: false,
        connected: s.value.connected,
        detail: s.value.configured ? "" : "No Spotify client configured — see .env",
        error: "",
      });
    } else setMusic({ loading: false, connected: false, detail: "", error: "Couldn't reach the backend." });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Consent finishes in the real browser, so poll rather than assume. */
  const connectAndPoll = async (
    key: string,
    begin: () => Promise<unknown>,
    isDone: () => Promise<boolean>
  ) => {
    setBusy(key);
    try {
      await begin();
      const started = Date.now();
      const poll = window.setInterval(async () => {
        try {
          if (await isDone()) {
            window.clearInterval(poll);
            setBusy("");
            refresh();
          } else if (Date.now() - started > 180000) {
            window.clearInterval(poll);
            setBusy("");
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch {
      setBusy("");
      refresh();
    }
  };

  const disconnect = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await run();
    } catch {
      /* refresh below reports the real state either way */
    }
    setBusy("");
    refresh();
  };

  return (
    <div
      id="settings_view"
      className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto"
    >
      <div className="flex items-center gap-3 border-b border-zinc-200/60 pb-4 mb-6 flex-shrink-0">
        <div className="p-2.5 bg-zinc-500/10 border border-zinc-500/20 rounded-2xl text-zinc-600 shadow-sm">
          <SettingsIcon className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">Settings</h1>
          <p className="text-xs text-zinc-500 font-medium">
            Your name, how Daisy speaks and listens, and what she's connected to
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto space-y-6 pt-3 pb-2">
          {/* Profile */}
          <Card className="p-5 pt-8">
            <CardBadge icon={User} accent="amber" />
            <CardTitle>Profile</CardTitle>
            <CardBody className="mt-1.5">
              What Daisy calls you — in her greeting, the title bar, and when she talks to you.
            </CardBody>
            <form onSubmit={saveName} className="mt-4 flex gap-2">
              <input
                type="text"
                value={nameDraft}
                maxLength={40}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Your name"
                aria-label="Your name"
                className="flex-1 min-w-0 bg-white border border-zinc-300 rounded-[10px] px-3 py-2 text-[13px] text-zinc-800 placeholder:text-zinc-400 shadow-[0_1px_2px_rgba(16,24,40,0.05)] focus:outline-none focus:border-zinc-400"
              />
              <CardAction type="submit" disabled={nameDraft.trim() === userName.trim()}>
                {nameSaved ? "Saved" : "Save"}
              </CardAction>
            </form>
          </Card>

          {/* Voice */}
          <Card className="p-5 pt-8">
            <CardBadge icon={Mic} accent="emerald" />
            <CardTitle>Voice</CardTitle>
            <div className="mt-2 divide-y divide-zinc-100">
              <Toggle
                label="Always listening"
                hint="Daisy listens without a wake word and works out whether you were talking to her."
                checked={alwaysListening}
                onChange={onToggleAlwaysListening}
              />
              <Toggle
                label="Speak replies aloud"
                hint="Read her answers out with the on-device voice."
                checked={speakReplies}
                onChange={(next) => {
                  daisyVoice.setEnabled(next);
                  writeVoicePref("speakReplies", next);
                  setSpeakReplies(next);
                }}
              />
            </div>
          </Card>

          {/* Connections */}
          <Card className="p-5 pt-8">
            <CardBadge icon={Link2} accent="blue" />
            <CardTitle>Connections</CardTitle>
            <CardBody className="mt-1.5">
              Each of these is optional — Daisy runs without them, just with less to talk about.
            </CardBody>
            <div className="mt-2 divide-y divide-zinc-100">
              <ConnectionRow
                name="Google Calendar"
                state={cal}
                busy={busy === "gcal"}
                onConnect={() =>
                  connectAndPoll("gcal", () => gcal.connect(), async () => (await gcal.status()).connected)
                }
                onDisconnect={() => disconnect("gcal", () => gcal.disconnect())}
              />
              <ConnectionRow
                name="Gmail"
                state={mail}
                busy={false}
                note="Shares the Google Calendar connection."
              />
              <ConnectionRow
                name="Spotify"
                state={music}
                busy={busy === "spotify"}
                onConnect={() =>
                  connectAndPoll("spotify", () => spotify.beginLogin(), async () => (await spotify.status()).connected)
                }
                onDisconnect={() => disconnect("spotify", () => spotify.logout())}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
