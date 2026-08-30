import React, { useCallback, useEffect, useState } from "react";
import { useCachedResource } from "../lib/useCachedResource";
import { CACHE_KEYS, readCache, writeCache } from "../lib/cache";
import { SkeletonMailList, SkeletonMailBody, RefreshingHint } from "./Skeleton";
import { Card, CardBadge } from "./Card";
import {
  Mail, Send, RefreshCw, Star, Archive, Trash2, Link2, AlertCircle,
  CheckCircle2, Loader2, Inbox, Search, X, CornerUpLeft,
} from "lucide-react";
import { GmailMessage } from "../types";
import { gmail, type GmailStatus } from "../lib/gmail";
import { gcal } from "../lib/gcal";
import { motion, AnimatePresence } from "motion/react";

/** "Full Name <email>" -> "Full Name" (or the raw address). */
function senderName(from: string): string {
  const m = /^(.*?)\s*</.exec(from);
  return (m?.[1] || from).replace(/^"|"$/g, "").trim() || from;
}

/** Compact relative-ish date for the list. */
function shortDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export default function WorkspaceGmail() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<GmailMessage | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Status and inbox both read through the cache, so switching away from Mail
  // and back repaints instantly from the last known state and refreshes behind
  // it. The skeleton below is therefore only reached on a true cold start.
  const statusRes = useCachedResource<GmailStatus>(
    CACHE_KEYS.gmailStatus,
    () => gmail.status(),
    { maxAgeMs: 30_000 }
  );
  const status = statusRes.data;
  const authorized = !!status?.gmailAuthorized;

  const inbox = useCachedResource<GmailMessage[]>(
    CACHE_KEYS.gmailMessages("INBOX", query),
    () => gmail.messages({ q: query, maxResults: 20 }),
    { enabled: authorized, maxAgeMs: 60_000 }
  );
  const messages = inbox.data ?? [];
  const loading = inbox.isRefreshing;

  // Compose
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const refreshStatus = useCallback(async () => {
    statusRes.refresh();
  }, [statusRes]);

  const loadInbox = useCallback((q = "") => {
    setQuery(q);
    inbox.refresh();
  }, [inbox]);

  // Keep a valid selection as the list changes, without clobbering the user's
  // current pick when a background refresh returns the same thread.
  useEffect(() => {
    setSelectedId((prev) =>
      prev && messages.some((m) => m.id === prev) ? prev : messages[0]?.id ?? null
    );
  }, [messages]);

  // Mutating helper so optimistic updates land in the cache too, not just in
  // component state — otherwise archiving a mail would reappear on tab switch.
  const patchMessages = useCallback(
    (fn: (list: GmailMessage[]) => GmailMessage[]) => inbox.mutate((cur) => fn(cur ?? [])),
    [inbox]
  );

  // Load the full body (and mark read) when a message is opened.
  useEffect(() => {
    if (!selectedId || !authorized) {
      setActive(null);
      return;
    }
    let cancelled = false;
    setBodyLoading(true);
    const cachedBody = readCache<GmailMessage>(CACHE_KEYS.gmailMessage(selectedId), 5 * 60_000);
    if (cachedBody) {
      setActive(cachedBody);
      setBodyLoading(false);
    }
    gmail
      .message(selectedId)
      .then((full) => {
        if (cancelled) return;
        writeCache(CACHE_KEYS.gmailMessage(full.id), full);
        setActive(full);
        if (full.unread) {
          // Reflect the read state locally without a full refetch.
          gmail.modify(full.id, "read").catch(() => {});
          patchMessages((prev) => prev.map((m) => (m.id === full.id ? { ...m, unread: false } : m)));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open that message.");
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, authorized]);

  const connect = async () => {
    setConnecting(true);
    try {
      await gcal.connect(); // one Google flow covers Calendar + Gmail
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
    } finally {
      setConnecting(false);
    }
  };

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadInbox(search.trim());
  };

  const act = async (id: string, action: "star" | "unstar" | "archive") => {
    try {
      if (action === "archive") {
        await gmail.modify(id, "archive");
        patchMessages((prev) => prev.filter((m) => m.id !== id));
        if (selectedId === id) setSelectedId(null);
      } else {
        const { message } = await gmail.modify(id, action);
        patchMessages((prev) => prev.map((m) => (m.id === id ? { ...m, starred: message.starred } : m)));
        setActive((a) => (a && a.id === id ? { ...a, starred: message.starred } : a));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    }
  };

  const trash = async (id: string) => {
    if (!window.confirm("Move this email to Trash?")) return;
    try {
      await gmail.trash(id);
      patchMessages((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that message.");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    if (!window.confirm(`Send this email to ${to}?\nSubject: ${subject}`)) return;

    setSending(true);
    setError("");
    try {
      await gmail.send({ to: to.trim(), subject: subject.trim(), body });
      setSendSuccess(true);
      setTo("");
      setSubject("");
      setBody("");
      setTimeout(() => setSendSuccess(false), 4000);
      loadInbox(search.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that email.");
    } finally {
      setSending(false);
    }
  };

  const replyTo = (msg: GmailMessage) => {
    const addr = /<([^>]+)>/.exec(msg.from)?.[1] || msg.from;
    setTo(addr);
    setSubject(msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`);
    setBody(`\n\n---\nOn ${msg.date}, ${senderName(msg.from)} wrote:\n> ${msg.snippet}`);
  };

  const unreadCount = messages.filter((m) => m.unread).length;
  const needsConnect = !status?.connected;
  const needsGmailScope = !!status?.connected && !authorized;

  return (
    <div id="gmail_workspace_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-600 shadow-sm">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">Gmail</h1>
            <p className="text-xs text-zinc-500 font-medium flex items-center gap-2">
              {authorized
                ? `${messages.length} message${messages.length === 1 ? "" : "s"}${unreadCount ? ` · ${unreadCount} unread` : ""}`
                : "Read and send mail through your Google account"}
              {/* Only while data is already on screen — a cold load shows the
                  skeleton instead, so these two never appear together. */}
              {authorized && inbox.isRefreshing && !inbox.isLoading && <RefreshingHint />}
            </p>
          </div>
        </div>

        {authorized && (
          <form onSubmit={runSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mail"
                className="w-44 bg-zinc-50 border border-zinc-200 rounded-full pl-8 pr-7 py-1.5 text-xs font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-rose-400 focus:bg-white transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    loadInbox("");
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => loadInbox(search.trim())}
              className="p-2 rounded-full hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 cursor-pointer transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-rose-500" : ""}`} />
            </button>
          </form>
        )}
      </div>

      {/* Not connected / missing scope */}
      {(needsConnect || needsGmailScope) && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 px-6">
          <div className="w-16 h-16 rounded-3xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500">
            <Inbox className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-zinc-800">
              {needsGmailScope ? "Reconnect Google to enable Gmail" : "Connect your Google account"}
            </h3>
            <p className="text-xs text-zinc-500 font-medium max-w-sm mt-1 leading-relaxed">
              {needsGmailScope
                ? "Your Google account is linked for Calendar, but was connected before Gmail was added. Reconnect once to grant inbox access — it uses the same sign-in."
                : status?.configured === false
                ? "Google isn't configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env, then restart Daisy."
                : "One Google sign-in powers both your Calendar and Gmail. Your mail is fetched by Daisy's local backend — no third-party servers."}
            </p>
          </div>
          {status?.configured !== false && (
            <button
              onClick={connect}
              disabled={connecting}
              className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold px-5 py-2.5 rounded-full transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {needsGmailScope ? "Reconnect Google" : "Connect Google"}
            </button>
          )}
          <button
            onClick={() => { statusRes.refresh(); inbox.refresh(); }}
            className="text-[11px] font-bold text-zinc-400 hover:text-zinc-700 cursor-pointer"
          >
            I've finished — refresh
          </button>
        </div>
      )}

      {/* Connected mailbox */}
      {authorized && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0">
          {/* Inbox list */}
          <Card className="lg:col-span-4 p-3 pt-8 flex flex-col min-h-[300px] lg:h-full lg:min-h-0">
            <CardBadge icon={Inbox} accent="rose" />
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {inbox.isLoading ? (
                <SkeletonMailList rows={6} />
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-10 text-zinc-400">
                  <Inbox className="w-7 h-7 mb-2 text-zinc-300" />
                  <p className="text-xs font-semibold">{search ? "No matches" : "Inbox zero 🌿"}</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const selected = msg.id === selectedId;
                  return (
                    <button
                      key={msg.id}
                      onClick={() => setSelectedId(msg.id)}
                      className={`w-full text-left p-3.5 rounded-[14px] border bg-white transition-all cursor-pointer relative shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${
                        selected
                          ? "border-zinc-900/15 ring-1 ring-zinc-900/10"
                          : "border-zinc-200/90 hover:border-zinc-300 hover:shadow-[0_1px_2px_rgba(16,24,40,0.05),0_8px_20px_-10px_rgba(16,24,40,0.16)]"
                      }`}
                    >
                      {msg.unread && (
                        <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-rose-500" />
                      )}
                      <div className="flex justify-between items-baseline gap-2 pl-1.5">
                        <span
                          className={`text-[13px] tracking-tight truncate ${
                            msg.unread ? "font-semibold text-zinc-900" : "font-medium text-zinc-600"
                          }`}
                        >
                          {senderName(msg.from)}
                        </span>
                        <span className="text-[12px] text-zinc-400 whitespace-nowrap flex items-center gap-1 shrink-0">
                          {msg.starred && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                          {shortDate(msg.date)}
                        </span>
                      </div>
                      <h4
                        className={`text-[13px] truncate mt-0.5 pl-1.5 ${
                          msg.unread ? "font-semibold text-zinc-900" : "text-zinc-700"
                        }`}
                      >
                        {msg.subject}
                      </h4>
                      <p className="text-[13px] leading-relaxed text-zinc-500 line-clamp-1 mt-0.5 pl-1.5">{msg.snippet}</p>
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          {/* Reader */}
          <div className="lg:col-span-4 bg-white border border-zinc-200/70 rounded-[28px] p-5 flex flex-col min-h-[300px] lg:h-full lg:min-h-0 shadow-sm">
            {bodyLoading && !active ? (
              <SkeletonMailBody />
            ) : active ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="border-b border-zinc-100 pb-3 mb-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-extrabold text-zinc-900 leading-snug">{active.subject}</h2>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => act(active.id, active.starred ? "unstar" : "star")}
                        title={active.starred ? "Unstar" : "Star"}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <Star className={`w-3.5 h-3.5 ${active.starred ? "fill-amber-400 text-amber-400" : "text-zinc-400"}`} />
                      </button>
                      <button
                        onClick={() => act(active.id, "archive")}
                        title="Archive"
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer transition-colors"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => trash(active.id)}
                        title="Delete"
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-zinc-400 hover:text-rose-600 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-zinc-600 mt-1.5">
                    <span className="text-rose-600 font-extrabold">{senderName(active.from)}</span>
                    <span className="text-zinc-400 font-mono text-[10px] ml-2">{shortDate(active.date)}</span>
                  </div>
                  <button
                    onClick={() => replyTo(active)}
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 hover:text-rose-600 cursor-pointer"
                  >
                    <CornerUpLeft className="w-3 h-3" /> Reply
                  </button>
                </div>

                <div className="text-xs text-zinc-700 leading-relaxed overflow-y-auto whitespace-pre-wrap pr-1 flex-1 min-h-0">
                  {active.body || active.snippet}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-zinc-400">
                <Mail className="w-8 h-8 text-zinc-300 mb-2" />
                <p className="text-xs font-medium">Select a message to read it</p>
              </div>
            )}
          </div>

          {/* Compose */}
          <div className="lg:col-span-4 bg-zinc-50/80 border border-zinc-200/60 rounded-[28px] p-5 flex flex-col min-h-[380px] lg:h-full lg:min-h-0 shadow-sm justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-rose-500" /> Compose
              </h3>
              <form onSubmit={handleSend} className="space-y-3">
                <input
                  type="email"
                  required
                  placeholder="To"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-300/40"
                />
                <input
                  type="text"
                  required
                  placeholder="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-300/40"
                />
                <textarea
                  required
                  rows={5}
                  placeholder="Write your message…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-300/40 resize-none"
                />
                <button
                  type="submit"
                  disabled={sending || !status.canSend}
                  title={status.canSend ? "" : "Reconnect Google to grant send access"}
                  className="w-full bg-gradient-to-r from-rose-400 to-amber-400 hover:from-rose-500 hover:to-amber-500 disabled:opacity-50 disabled:cursor-default text-white rounded-xl py-2.5 text-xs font-extrabold hover:shadow-md active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </div>

            <AnimatePresence>
              {sendSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 p-2.5 rounded-xl text-center flex items-center justify-center gap-1.5 text-[11px] font-bold"
                >
                  <CheckCircle2 className="w-4 h-4" /> Sent!
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 flex-shrink-0">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => setError("")} className="ml-auto cursor-pointer hover:text-rose-900">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
