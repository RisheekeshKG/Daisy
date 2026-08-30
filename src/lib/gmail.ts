/**
 * Gmail client — thin wrapper over Daisy's backend /api/gmail/* routes.
 *
 * Gmail shares the one Google connection that the Calendar uses; there is no
 * separate sign-in. The backend owns the OAuth token, so the renderer never
 * touches an access token — which is also what makes this work inside Electron,
 * where a renderer-side sign-in popup has no real web origin to return to.
 */

import type { GmailMessage } from "../types";

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  /** True only once the shared Google token includes Gmail scopes. A token from
   *  before Gmail was added is `connected` but not `gmailAuthorized`. */
  gmailAuthorized: boolean;
  canSend: boolean;
}

export class GmailRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GmailRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/gmail${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new GmailRequestError(res.status, data?.error || `Gmail request failed (${res.status})`);
  }
  return data as T;
}

export const gmail = {
  status: () => request<GmailStatus>("/status"),

  messages: async (opts: { q?: string; label?: string; maxResults?: number } = {}): Promise<GmailMessage[]> => {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.label) params.set("label", opts.label);
    if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
    const qs = params.toString();
    const data = await request<{ messages: GmailMessage[] }>(`/messages${qs ? `?${qs}` : ""}`);
    return data.messages || [];
  },

  message: async (id: string): Promise<GmailMessage> =>
    (await request<{ message: GmailMessage }>(`/messages/${encodeURIComponent(id)}`)).message,

  send: (msg: { to: string; subject: string; body: string; cc?: string }) =>
    request<{ ok: boolean; id: string }>("/send", {
      method: "POST",
      body: JSON.stringify(msg),
    }),

  modify: (id: string, action: "read" | "unread" | "star" | "unstar" | "archive") =>
    request<{ ok: boolean; message: GmailMessage }>(`/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  trash: (id: string) =>
    request<{ ok: boolean }>(`/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
