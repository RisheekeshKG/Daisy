/**
 * Date helpers for the calendar view.
 *
 * Everything here works on Daisy's local wall-clock strings ("YYYY-MM-DDTHH:MM")
 * rather than Date objects wherever possible. Parsing those with `new Date(s)`
 * is unsafe — a bare "YYYY-MM-DD" is read as UTC by the spec and silently
 * shifts a day for anyone west of Greenwich, which is exactly the kind of
 * off-by-one that makes a calendar untrustworthy.
 */

import type { CalendarEvent } from "../types";
import type { GCalAttendee, GCalCalendar, GCalEvent, GCalReminders } from "../lib/gcal";

/** A Google event and a local-only event flattened into one display shape. */
export interface UnifiedEvent {
  /** Stable React key, unique across both sources. */
  key: string;
  googleId?: string;
  calendarId?: string;
  /** Set for events that live only in Daisy, never sent to Google. */
  localId?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  colorId: string;
  htmlLink?: string;
  meetLink?: string;
  recurrence: string[];
  attendees: GCalAttendee[];
  reminders: GCalReminders;
  /** Resolved swatch, from the event colour or its calendar's colour. */
  color: string;
  calendarName: string;
  readOnly: boolean;
  completed?: boolean;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local "YYYY-MM-DD" for a Date (never UTC — see file header). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

/** Split "YYYY-MM-DDTHH:MM" into its date and time halves. */
export function splitLocal(value: string): { date: string; time: string } {
  const [date = todayYmd(), time = "09:00"] = (value || "").split("T");
  return { date, time: time.slice(0, 5) };
}

export function joinLocal(date: string, time: string): string {
  return `${date}T${(time || "00:00").slice(0, 5)}`;
}

/** Add minutes to an "HH:MM" clock time, clamped to the same day. */
export function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + delta);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" as a *local* midnight Date. */
export function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

/**
 * The 6×7 grid Google draws: every day of the month plus the leading and
 * trailing days needed to fill whole weeks.
 */
export function monthMatrix(year: number, month: number): Array<{ date: string; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: ymd(d), inMonth: d.getMonth() === month });
  }
  // Drop a trailing all-next-month week so short months don't render a dead row.
  while (cells.length > 35 && !cells.slice(35).some((c) => c.inMonth)) cells.length = 35;
  return cells;
}

/** "3:05 PM" for an "HH:MM" clock time. */
export function formatClock(time: string): string {
  const [h, m] = (time || "00:00").split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

/** "Thursday, 23 July 2026" */
export function formatLongDate(date: string): string {
  const d = parseDay(date);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Human summary of an RRULE, for a badge on the event card. */
export function describeRecurrence(rules: string[]): string {
  const rule = (rules || [])[0] || "";
  if (!rule) return "";
  const freq = /FREQ=([A-Z]+)/.exec(rule)?.[1] || "";
  if (/BYDAY=MO,TU,WE,TH,FR/.test(rule)) return "Weekdays";
  return (
    { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" } as Record<string, string>
  )[freq] || "Repeats";
}

/** Every date an event covers, so multi-day events show on each day. */
export function daysCovered(event: { start: string; end: string }): string[] {
  const startDay = (event.start || "").slice(0, 10);
  const endDay = (event.end || event.start || "").slice(0, 10);
  if (!startDay) return [];
  if (endDay <= startDay) return [startDay];

  const out: string[] = [];
  const cursor = parseDay(startDay);
  const last = parseDay(endDay);
  // Guard against a malformed event producing an unbounded loop.
  for (let i = 0; i <= 366 && cursor <= last; i++) {
    out.push(ymd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Google event -> display shape, resolving its colour against its calendar. */
export function fromGoogle(
  event: GCalEvent,
  calendars: GCalCalendar[],
  colors: Record<string, { background: string }>
): UnifiedEvent {
  const calendar = calendars.find((c) => c.id === event.calendarId);
  return {
    key: `g:${event.calendarId}:${event.googleId}`,
    googleId: event.googleId,
    calendarId: event.calendarId,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    description: event.description,
    location: event.location,
    colorId: event.colorId,
    htmlLink: event.htmlLink,
    meetLink: event.meetLink,
    recurrence: event.recurrence || [],
    attendees: event.attendees || [],
    reminders: event.reminders || { useDefault: true, overrides: [] },
    color: colors[event.colorId]?.background || calendar?.backgroundColor || "#4285f4",
    calendarName: calendar?.summary || "Google Calendar",
    readOnly: calendar ? !calendar.canEdit : false,
  };
}

/** A Daisy-only event (never pushed to Google) -> the same display shape. */
export function fromLocal(event: CalendarEvent): UnifiedEvent {
  const palette: Record<string, string> = {
    work: "#4285f4",
    personal: "#e67c73",
    health: "#33b679",
    media: "#8e24aa",
    ai: "#f6bf26",
  };
  return {
    key: `l:${event.id}`,
    localId: event.id,
    title: event.title,
    start: event.start,
    end: event.end || event.start,
    allDay: false,
    description: event.description || "",
    location: "",
    colorId: "",
    recurrence: [],
    attendees: [],
    reminders: { useDefault: true, overrides: [] },
    color: palette[event.category || "work"] || "#71717a",
    calendarName: "Daisy (local)",
    readOnly: false,
    completed: event.completed,
  };
}
