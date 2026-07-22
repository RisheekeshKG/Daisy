import React, { useState, useEffect } from "react";
import { Mail, Send, RefreshCw, UserCheck, ShieldAlert, FileText, CheckCircle2 } from "lucide-react";
import { GmailMessage } from "../types";
import { googleSignIn, logout, getAccessToken, initAuth } from "../lib/googleAuth";
import { fetchGmailInbox, sendGmailMessage, SANDBOX_EMAILS } from "../lib/gmailApi";
import { motion, AnimatePresence } from "motion/react";

export default function WorkspaceGmail() {
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<GmailMessage[]>(SANDBOX_EMAILS);
  
  // Compose state
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  
  // Selected message state for preview
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(SANDBOX_EMAILS[0]?.id || null);

  // Initialize auth listener
  useEffect(() => {
    const unsub = initAuth(
      (firebaseUser, accessToken) => {
        setUser(firebaseUser);
        setToken(accessToken);
        setNeedsAuth(false);
        loadInbox(accessToken);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
        setMessages(SANDBOX_EMAILS);
      }
    );
    return () => {
      unsub.then(cleanup => { if (cleanup) cleanup(); });
    };
  }, []);

  const loadInbox = async (accessToken: string) => {
    setLoading(true);
    try {
      const fetched = await fetchGmailInbox(accessToken);
      if (fetched && fetched.length > 0) {
        setMessages(fetched);
        setSelectedMsgId(fetched[0].id);
      } else {
        setMessages([]);
        setSelectedMsgId(null);
      }
    } catch (err) {
      console.warn("Could not load real inbox. Using sandbox data.");
      setMessages(SANDBOX_EMAILS);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setNeedsAuth(false);
        loadInbox(res.accessToken);
      }
    } catch (err) {
      console.error("Login failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setNeedsAuth(true);
    setMessages(SANDBOX_EMAILS);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !subject || !body) return;

    // Explicit User Confirmation before mutating/destructive action
    const confirmed = window.confirm(
      `Are you sure you want to send this email to ${to}?\nSubject: ${subject}`
    );
    if (!confirmed) return;

    setSending(true);
    const tokenToUse = token || await getAccessToken();
    if (!tokenToUse) {
      alert("Authentication token expired. Please sign in again.");
      setSending(false);
      return;
    }

    const success = await sendGmailMessage(tokenToUse, to, subject, body);
    setSending(false);
    if (success) {
      setSendSuccess(true);
      setTo("");
      setSubject("");
      setBody("");
      setTimeout(() => setSendSuccess(false), 4000);
      loadInbox(tokenToUse);
    } else {
      alert("Failed to send email. Ensure you are fully logged in and authorized.");
    }
  };

  const activeMsg = messages.find((m) => m.id === selectedMsgId);

  return (
    <div id="gmail_workspace_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl relative text-amber-600 shadow-sm">
            <Mail className="w-6 h-6" />
            <span className="absolute -top-1.5 -right-1 text-xs animate-bounce">🌸</span>
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">
              Gmail Workspace
            </h1>
            <p className="text-xs text-zinc-500 font-semibold">
              {needsAuth ? "Sandbox Mode • Authorize to sync real inbox 🌻" : `Connected as ${user?.email || "User"} ✨`}
            </p>
          </div>
        </div>

        {/* Auth action button */}
        <div className="flex items-center gap-3">
          {needsAuth ? (
            <button
              onClick={handleLogin}
              className="gsi-material-button hover:shadow-md transition-all shrink-0 scale-90 hover:scale-95"
              style={{
                backgroundColor: "white",
                border: "1px solid #e4e4e7",
                borderRadius: "20px",
                padding: "4px 12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <div style={{ width: "18px", height: "18px", display: "flex", alignItems: "center" }}>
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: "block" }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="text-xs font-semibold text-zinc-700">Sign in with Google</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadInbox(token!)}
                className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer"
                title="Refresh Inbox"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-amber-500" : ""}`} />
              </button>
              <button
                onClick={handleLogout}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-full cursor-pointer transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        {/* Inbox List (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-zinc-50/80 border border-zinc-200/60 rounded-[28px] p-4 flex flex-col min-h-[300px] lg:h-full lg:min-h-0 shadow-inner">
          <div className="mb-3 px-1 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Inbox ({messages.length})
            </h3>
            {needsAuth && (
              <span className="text-[10px] bg-amber-500/10 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Sandbox
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {messages.length === 0 ? (
              <div className="text-center py-10 text-zinc-400 text-xs">
                No emails found in this category.
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = msg.id === selectedMsgId;
                return (
                  <div
                    key={msg.id}
                    onClick={() => setSelectedMsgId(msg.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? "bg-white border-amber-400 shadow-md ring-1 ring-amber-300/20"
                        : "bg-white/80 border-zinc-200/60 hover:bg-white hover:border-zinc-350 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="text-xs font-extrabold text-zinc-800 truncate max-w-[120px]">
                        {msg.from.split(" <")[0]}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-400 whitespace-nowrap">
                        {msg.date}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-zinc-900 truncate mb-1">
                      {msg.subject}
                    </h4>
                    <p className="text-[10px] text-zinc-500 line-clamp-2">
                      {msg.snippet}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Message Previewer (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white border border-zinc-150 rounded-[28px] p-5 flex flex-col justify-between min-h-[300px] lg:h-full lg:min-h-0 shadow-sm">
          {activeMsg ? (
            <div className="flex-1 flex flex-col min-h-0 justify-between">
              <div>
                <div className="border-b border-zinc-150 pb-3 mb-3">
                  <div className="text-[10px] text-zinc-400 mb-1 font-mono">{activeMsg.date}</div>
                  <h2 className="text-sm font-bold text-zinc-900 mb-1 leading-snug">
                    {activeMsg.subject}
                  </h2>
                  <div className="text-xs font-semibold text-zinc-600">
                    From: <span className="text-amber-600 font-extrabold">{activeMsg.from}</span>
                  </div>
                </div>

                <div className="text-xs text-zinc-700 leading-relaxed overflow-y-auto max-h-[220px] whitespace-pre-wrap pr-1">
                  {activeMsg.snippet}
                  {activeMsg.body && (
                    <div className="mt-4 pt-4 border-t border-zinc-150 text-zinc-600 font-normal">
                      {activeMsg.body}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-200/60 mt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                  <UserCheck className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Verified Google Workspace Sandbox Header</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-zinc-400">
              <Mail className="w-8 h-8 text-zinc-300 mb-2" />
              <p className="text-xs">Select a message from the inbox to read its contents</p>
            </div>
          )}
        </div>

        {/* Compose Email Panel (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-zinc-50/80 border border-zinc-200/60 rounded-[28px] p-5 flex flex-col min-h-[380px] lg:h-full lg:min-h-0 shadow-sm justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-amber-500" /> Compose Message
            </h3>

            <form onSubmit={handleSendEmail} className="space-y-3">
              <div>
                <input
                  type="email"
                  required
                  placeholder="Recipient (e.g. user@example.com)"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full bg-white border border-zinc-200/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300/50 focus:border-amber-400 focus:ring-2"
                />
              </div>

              <div>
                <input
                  type="text"
                  required
                  placeholder="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-white border border-zinc-200/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300/50 focus:border-amber-400 focus:ring-2"
                />
              </div>

              <div>
                <textarea
                  required
                  rows={4}
                  placeholder="Write your email draft here..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full bg-white border border-zinc-200/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300/50 focus:border-amber-400 focus:ring-2 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full bg-gradient-to-r from-amber-400 to-rose-400 hover:from-amber-500 hover:to-rose-500 text-white rounded-xl py-2 text-xs font-extrabold hover:shadow-md hover:scale-[1.01] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                {sending ? "Sending..." : "Send Message"}
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

          <AnimatePresence>
            {sendSuccess && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 p-2.5 rounded-xl text-center flex items-center justify-center gap-1.5 text-[11px]"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Email transmitted successfully!</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
