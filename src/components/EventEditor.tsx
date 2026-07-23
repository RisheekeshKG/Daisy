/**
 * Create/edit dialog for a Google Calendar event.
 *
 * Covers the fields Google's own composer exposes: calendar, colour, all-day,
 * start/end, location, description, recurrence, reminders and guests. Fields
 * are only sent when changed, so editing one instance of a series does not
 * silently rewrite the rest of it.
 */

import React, { useEffect, useMemo, useState } from "react";
import { X, Trash2, MapPin, Users, Bell, Repeat, Palette, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import type { GCalCalendar, GCalColorMap, GCalEventInput } from "../lib/gcal";
import type { UnifiedEvent } from "./calendarUtils";
import { addMinutes, splitLocal, joinLocal } from "./calendarUtils";

/** RRULE presets — the same set Google offers in its own dropdown. */
const RECURRENCE_PRESETS: Array<{ label: string; rule: string }> = [
  { label: "Does not repeat", rule: "" },
  { label: "Every day", rule: "RRULE:FREQ=DAILY" },
  { label: "Every week", rule: "RRULE:FREQ=WEEKLY" },
  { label: "Every weekday (Mon–Fri)", rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Every month", rule: "RRULE:FREQ=MONTHLY" },
  { label: "Every year", rule: "RRULE:FREQ=YEARLY" },
];

const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440];

function reminderLabel(minutes: number): string {
  if (minutes === 0) return "At start";
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) return `${minutes / 60} hr before`;
  return `${minutes / 1440} day before`;
}

export interface EventEditorProps {
  event: UnifiedEvent | null;
  /** Pre-selected day for a brand-new event (YYYY-MM-DD). */
  defaultDate: string;
  calendars: GCalCalendar[];
  colors: GCalColorMap;
  onClose: () => void;
  onSave: (patch: GCalEventInput, isNew: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function EventEditor({
  event,
  defaultDate,
  calendars,
  colors,
  onClose,
  onSave,
  onDelete,
}: EventEditorProps) {
  const isNew = !event?.googleId;
  const writableCalendars = useMemo(() => calendars.filter((c) => c.canEdit), [calendars]);

  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState("primary");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(defaultDate);
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [colorId, setColorId] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [useDefaultReminder, setUseDefaultReminder] = useState(true);
  const [reminderMinutes, setReminderMinutes] = useState(10);
  const [guests, setGuests] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Seed the form from the event being edited (or sensible defaults for a new one).
  useEffect(() => {
    if (event) {
      const s = splitLocal(event.start);
      const e = splitLocal(event.end || event.start);
      setTitle(event.title);
      setCalendarId(event.calendarId || "primary");
      setAllDay(event.allDay);
      setStartDate(s.date);
      setStartTime(s.time);
      setEndDate(e.date);
      setEndTime(e.time);
      setLocation(event.location || "");
      setDescription(event.description || "");
      setColorId(event.colorId || "");
      // Only the presets are offered; a custom rule from Google is preserved
      // as-is by matching on prefix rather than being silently downgraded.
      setRecurrence(event.recurrence?.[0] || "");
      setUseDefaultReminder(event.reminders?.useDefault ?? true);
      setReminderMinutes(event.reminders?.overrides?.[0]?.minutes ?? 10);
      setGuests((event.attendees || []).map((a) => a.email).join(", "));
    } else {
      setTitle("");
      setCalendarId(writableCalendars[0]?.id || "primary");
      setAllDay(false);
      setStartDate(defaultDate);
      setEndDate(defaultDate);
      const now = new Date();
      const hh = String(Math.min(23, now.getHours() + 1)).padStart(2, "0");
      setStartTime(`${hh}:00`);
      setEndTime(`${String(Math.min(23, now.getHours() + 2)).padStart(2, "0")}:00`);
      setLocation("");
      setDescription("");
      setColorId("");
      setRecurrence("");
      setUseDefaultReminder(true);
      setReminderMinutes(10);
      setGuests("");
    }
    setError("");
  }, [event, defaultDate, writableCalendars]);

  // Keep the end from drifting before the start as the user edits the start.
  const handleStartTime = (value: string) => {
    setStartTime(value);
    if (startDate === endDate && value >= endTime) setEndTime(addMinutes(value, 60));
  };

  const selectedCalendar = calendars.find((c) => c.id === calendarId);
  const readOnly = !!selectedCalendar && !selectedCalendar.canEdit;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the event a title.");
      return;
    }
    const start = allDay ? `${startDate}T00:00` : joinLocal(startDate, startTime);
    const end = allDay ? `${endDate}T00:00` : joinLocal(endDate, endTime);
    if (end < start) {
      setError("The event ends before it starts.");
      return;
    }

    const patch: GCalEventInput = {
      calendarId,
      title: title.trim(),
      start,
      end,
      allDay,
      location: location.trim(),
      description: description.trim(),
      colorId,
      recurrence: recurrence ? [recurrence] : [],
      reminders: useDefaultReminder
        ? { useDefault: true, overrides: [] }
        : { useDefault: false, overrides: [{ method: "popup", minutes: reminderMinutes }] },
      attendees: guests
        .split(/[,\s]+/)
        .map((g) => g.trim())
        .filter((g) => g.includes("@"))
        .map((email) => ({ email })),
    };

    setBusy(true);
    setError("");
    try {
      await onSave(patch, isNew);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that event.");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const swatches = Object.entries(colors);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-white rounded-[28px] shadow-2xl border border-zinc-200"
      >
        <form onSubmit={submit} className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-zinc-900">
                {isNew ? "New event" : "Edit event"}
              </h3>
              <p className="text-[11px] text-zinc-400 font-medium">
                {isNew ? "Added straight to Google Calendar" : "Changes sync to Google Calendar"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a title"
            className="w-full bg-transparent border-b-2 border-zinc-200 focus:border-blue-500 px-1 py-2 text-lg font-bold text-zinc-900 placeholder-zinc-300 focus:outline-none transition-colors"
          />

          {/* When */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-2 text-xs font-bold text-zinc-600 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
              />
              All day
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Starts</span>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (e.target.value > endDate) setEndDate(e.target.value);
                    }}
                    className="flex-1 min-w-0 bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400"
                  />
                  {!allDay && (
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => handleStartTime(e.target.value)}
                      className="w-[86px] bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Ends</span>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="flex-1 min-w-0 bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400"
                  />
                  {!allDay && (
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-[86px] bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Repeat */}
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <Repeat className="w-3 h-3" /> Repeat
            </span>
            <select
              value={RECURRENCE_PRESETS.some((p) => p.rule === recurrence) ? recurrence : "custom"}
              onChange={(e) => setRecurrence(e.target.value === "custom" ? recurrence : e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              {RECURRENCE_PRESETS.map((p) => (
                <option key={p.label} value={p.rule}>{p.label}</option>
              ))}
              {!RECURRENCE_PRESETS.some((p) => p.rule === recurrence) && (
                <option value="custom">Custom rule (kept as-is)</option>
              )}
            </select>
          </label>

          {/* Where + notes */}
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <MapPin className="w-3 h-3" /> Location
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add a place"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-blue-400"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Add notes"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-blue-400 resize-none"
            />
          </label>

          {/* Guests */}
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <Users className="w-3 h-3" /> Guests
            </span>
            <input
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              placeholder="email@example.com, another@example.com"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-blue-400"
            />
          </label>

          {/* Reminder */}
          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <Bell className="w-3 h-3" /> Notification
            </span>
            <div className="flex items-center gap-2">
              <select
                value={useDefaultReminder ? "default" : String(reminderMinutes)}
                onChange={(e) => {
                  if (e.target.value === "default") setUseDefaultReminder(true);
                  else {
                    setUseDefaultReminder(false);
                    setReminderMinutes(Number(e.target.value));
                  }
                }}
                className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400 cursor-pointer"
              >
                <option value="default">Calendar default</option>
                {REMINDER_CHOICES.map((m) => (
                  <option key={m} value={m}>{reminderLabel(m)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Calendar + colour */}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Calendar</span>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-zinc-800 focus:outline-none focus:border-blue-400 cursor-pointer"
              >
                {(writableCalendars.length ? writableCalendars : calendars).map((c) => (
                  <option key={c.id} value={c.id}>{c.summary}</option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <Palette className="w-3 h-3" /> Colour
              </span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setColorId("")}
                  title="Calendar colour"
                  className={`w-5 h-5 rounded-full border-2 bg-zinc-200 transition-transform ${
                    colorId === "" ? "border-zinc-800 scale-110" : "border-transparent hover:scale-105"
                  }`}
                />
                {swatches.map(([id, c]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setColorId(id)}
                    style={{ backgroundColor: c.background }}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      colorId === id ? "border-zinc-800 scale-110" : "border-transparent hover:scale-105"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          {readOnly && (
            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              You only have read access to this calendar.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            {onDelete && !isNew ? (
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onDelete();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not delete.");
                    setBusy(false);
                  }
                }}
                className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 hover:text-rose-600 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs font-bold text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || readOnly}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default text-white text-xs font-bold cursor-pointer transition-all active:scale-95"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isNew ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
