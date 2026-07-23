/**
 * Google Calendar client — thin wrapper over Daisy's backend /api/gcal/* routes.
 *
 * All OAuth and token handling lives in the backend (backend/gcal.py); the
 * frontend never sees an access token.
 */

import { daisyBridge } from "./daisyBridge";

export interface GCalStatus {
  configured: boolean;
  connected: boolean;
  /** True when a token is saved but Google rejected the request anyway —
   *  signing in again will not help, so `error` explains what to fix. */
  authorized?: boolean;
  error?: string;
  redirectUri: string;
  account?: { id: string; summary: string; timeZone: string };
}

/** One entry from the user's calendar list, with the colours Google shows. */
export interface GCalCalendar {
  id: string;
  summary: string;
  description: string;
  primary: boolean;
  selected: boolean;
  backgroundColor: string;
  foregroundColor: string;
  timeZone: string;
  accessRole: string;
  /** False for calendars shared read-only — the UI blocks editing on these. */
  canEdit: boolean;
}

export interface GCalAttendee {
  email: string;
  displayName: string;
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted" | string;
  optional: boolean;
  organizer: boolean;
  self: boolean;
}

export interface GCalReminders {
  useDefault: boolean;
  overrides: Array<{ method: string; minutes: number }>;
}

/** An event as returned by the backend, already in Daisy's local-time format. */
export interface GCalEvent {
  googleId: string;
  calendarId: string;
  title: string;
  start: string; // YYYY-MM-DDTHH:MM (local)
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  colorId: string;
  status: string;
  htmlLink?: string;
  meetLink?: string;
  recurrence: string[];
  recurringEventId: string;
  reminders: GCalReminders;
  attendees: GCalAttendee[];
  organizer: { email: string; displayName: string; self: boolean };
  transparency: string;
  visibility: string;
  updated: string;
}

export type GCalColorMap = Record<string, { background: string; foreground: string }>;

export class GCalRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GCalRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/gcal${path}`, {
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
    throw new GCalRequestError(res.status, data?.error || `Google Calendar request failed (${res.status})`);
  }
  return data as T;
}

/** Fields accepted when creating or updating. Omitted keys are left untouched. */
export interface GCalEventInput {
  calendarId?: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  colorId?: string;
  recurrence?: string[];
  reminders?: GCalReminders;
  attendees?: Array<{ email: string; optional?: boolean }>;
  transparency?: string;
  visibility?: string;
}

export const gcal = {
  status: () => request<GCalStatus>("/status"),

  /**
   * Kick off the OAuth consent flow. Google refuses to render its consent page
   * inside an embedded webview, so route it through Electron's shell when
   * available and fall back to a new tab in the browser build.
   */
  async connect(): Promise<void> {
    const { url } = await request<{ url: string }>("/login");
    if (daisyBridge?.openExternal) {
      const opened = await daisyBridge.openExternal(url);
      if (opened) return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  disconnect: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  calendars: async (): Promise<GCalCalendar[]> =>
    (await request<{ calendars: GCalCalendar[] }>("/calendars")).calendars || [],

  colors: async (): Promise<GCalColorMap> =>
    (await request<{ event: GCalColorMap }>("/colors")).event || {},

  events: async (
    pastDays = 7,
    futureDays = 60,
    calendarIds: string[] = [],
    query = ""
  ): Promise<GCalEvent[]> => {
    const params = new URLSearchParams({
      pastDays: String(pastDays),
      futureDays: String(futureDays),
    });
    if (calendarIds.length) params.set("calendarIds", calendarIds.join(","));
    if (query) params.set("q", query);
    const data = await request<{ events: GCalEvent[] }>(`/events?${params}`);
    return data.events || [];
  },

  createEvent: async (event: GCalEventInput): Promise<GCalEvent> =>
    (
      await request<{ event: GCalEvent }>("/events", {
        method: "POST",
        body: JSON.stringify(event),
      })
    ).event,

  /** Natural language: "Lunch with Sam Friday 1pm". Google does the parsing. */
  quickAdd: async (text: string, calendarId = "primary"): Promise<GCalEvent> =>
    (
      await request<{ event: GCalEvent }>("/events/quick-add", {
        method: "POST",
        body: JSON.stringify({ text, calendarId }),
      })
    ).event,

  updateEvent: async (googleId: string, event: GCalEventInput): Promise<GCalEvent> =>
    (
      await request<{ event: GCalEvent }>(`/events/${encodeURIComponent(googleId)}`, {
        method: "PATCH",
        body: JSON.stringify(event),
      })
    ).event,

  moveEvent: async (googleId: string, calendarId: string, destination: string): Promise<GCalEvent> =>
    (
      await request<{ event: GCalEvent }>(`/events/${encodeURIComponent(googleId)}/move`, {
        method: "POST",
        body: JSON.stringify({ calendarId, destination }),
      })
    ).event,

  /** RSVP to an invitation. */
  respond: async (
    googleId: string,
    calendarId: string,
    response: "accepted" | "declined" | "tentative"
  ): Promise<GCalEvent> =>
    (
      await request<{ event: GCalEvent }>(`/events/${encodeURIComponent(googleId)}/respond`, {
        method: "POST",
        body: JSON.stringify({ calendarId, response }),
      })
    ).event,

  deleteEvent: (googleId: string, calendarId = "primary") =>
    request<{ ok: boolean }>(
      `/events/${encodeURIComponent(googleId)}?calendarId=${encodeURIComponent(calendarId)}`,
      { method: "DELETE" }
    ),

  freeBusy: async (start: string, end: string, calendarIds: string[] = []) => {
    const params = new URLSearchParams({ start, end });
    if (calendarIds.length) params.set("calendarIds", calendarIds.join(","));
    const data = await request<{ busy: Array<{ calendarId: string; start: string; end: string }> }>(
      `/freebusy?${params}`
    );
    return data.busy || [];
  },
};
