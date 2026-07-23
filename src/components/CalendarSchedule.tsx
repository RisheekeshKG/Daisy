/**
 * Daisy's calendar — a real Google Calendar client.
 *
 * Google data is fetched here rather than passed down, the same way SpotifyPanel
 * owns its own playback state: the view needs multiple calendars, colours and
 * per-event detail that never fit through App's single local event list. Local
 * Daisy-only events still arrive via props and are merged in for display; any
 * event that came from Google is filtered out of that list so a synced copy
 * cannot render twice.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar as CalendarIcon, Clock, Plus, ChevronLeft, ChevronRight, Check,
  RefreshCw, Link2 as LinkIcon, Search, MapPin, Users, Video, Repeat, Bell,
  ExternalLink, Loader2, Sparkles, X, AlertCircle, Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CalendarEvent } from "../types";
import {
  gcal, type GCalCalendar, type GCalColorMap, type GCalEvent, type GCalEventInput,
} from "../lib/gcal";
import EventEditor from "./EventEditor";
import {
  WEEKDAYS, monthMatrix, monthLabel, todayYmd, ymd, formatClock, formatLongDate,
  describeRecurrence, daysCovered, fromGoogle, fromLocal, parseDay,
  type UnifiedEvent,
} from "./calendarUtils";

interface CalendarScheduleProps {
  events: CalendarEvent[];
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onUpdateEvent?: (event: CalendarEvent) => void;
  googleConnected?: boolean;
  googleSyncing?: boolean;
  googleError?: string;
  googleLastSync?: string;
  onGoogleConnect?: () => void;
  onGoogleDisconnect?: () => void;
  onGoogleSync?: () => void;
}

/** Days of Google data to hold around the visible month. */
const WINDOW_DAYS = 45;

export default function CalendarSchedule({
  events,
  onDeleteEvent,
  onToggleComplete,
  googleConnected = false,
  googleSyncing = false,
  googleError = "",
  googleLastSync = "",
  onGoogleConnect,
  onGoogleDisconnect,
  onGoogleSync,
}: CalendarScheduleProps) {
  const today = todayYmd();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(today);

  const [calendars, setCalendars] = useState<GCalCalendar[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colors, setColors] = useState<GCalColorMap>({});
  const [googleEvents, setGoogleEvents] = useState<GCalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [quickAdd, setQuickAdd] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [editing, setEditing] = useState<UnifiedEvent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  // Guards against a slow response for an old month overwriting a newer one.
  const requestRef = useRef(0);

  const visibleCalendarIds = useMemo(
    () => calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id),
    [calendars, hidden]
  );

  const loadCalendars = useCallback(async () => {
    try {
      const [list, palette] = await Promise.all([gcal.calendars(), gcal.colors()]);
      setCalendars(list);
      setColors(palette);
      // Respect the show/hide state the user already set in Google itself.
      setHidden(new Set(list.filter((c) => !c.selected).map((c) => c.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your calendars.");
    }
  }, []);

  const loadEvents = useCallback(
    async (ids: string[], query: string) => {
      if (!ids.length) {
        setGoogleEvents([]);
        return;
      }
      const ticket = ++requestRef.current;
      setLoading(true);
      try {
        // Anchor the window on the month being viewed, not on today, so paging
        // back a few months still shows data.
        const anchor = new Date(cursor.year, cursor.month, 15);
        const offsetDays = Math.round((anchor.getTime() - Date.now()) / 86400000);
        const list = await gcal.events(
          Math.max(0, WINDOW_DAYS - offsetDays),
          Math.max(1, WINDOW_DAYS + offsetDays),
          ids,
          query
        );
        if (ticket !== requestRef.current) return;
        setGoogleEvents(list);
        setError("");
      } catch (err) {
        if (ticket !== requestRef.current) return;
        setError(err instanceof Error ? err.message : "Could not load your events.");
      } finally {
        if (ticket === requestRef.current) setLoading(false);
      }
    },
    [cursor.year, cursor.month]
  );

  useEffect(() => {
    if (googleConnected) loadCalendars();
    else {
      setCalendars([]);
      setGoogleEvents([]);
    }
  }, [googleConnected, loadCalendars]);

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    if (!googleConnected) return;
    const id = window.setTimeout(() => loadEvents(visibleCalendarIds, search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [googleConnected, visibleCalendarIds, search, loadEvents]);

  /** Google events plus any Daisy-only ones, indexed by day. */
  const eventsByDay = useMemo(() => {
    const unified: UnifiedEvent[] = [
      ...googleEvents.map((e) => fromGoogle(e, calendars, colors)),
      // Anything already carrying a googleId is the synced copy of an event we
      // just fetched — showing both would duplicate every synced item.
      ...events.filter((e) => !e.googleId).map(fromLocal),
    ];

    const filtered = search.trim()
      ? unified.filter((e) =>
          `${e.title} ${e.location} ${e.description}`.toLowerCase().includes(search.trim().toLowerCase())
        )
      : unified;

    const map = new Map<string, UnifiedEvent[]>();
    for (const event of filtered) {
      for (const day of daysCovered(event)) {
        const bucket = map.get(day);
        if (bucket) bucket.push(event);
        else map.set(day, [event]);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      });
    }
    return map;
  }, [googleEvents, events, calendars, colors, search]);

  const cells = useMemo(() => monthMatrix(cursor.year, cursor.month), [cursor]);
  const selectedEvents = eventsByDay.get(selectedDate) || [];

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(ymd(now));
  };

  const refresh = async () => {
    await loadCalendars();
    await loadEvents(visibleCalendarIds, search.trim());
    onGoogleSync?.();
  };

  const toggleCalendar = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickAdd.trim();
    if (!text) return;
    setQuickBusy(true);
    try {
      const created = await gcal.quickAdd(text, calendars.find((c) => c.primary)?.id || "primary");
      setQuickAdd("");
      setSelectedDate(created.start.slice(0, 10));
      await loadEvents(visibleCalendarIds, "");
      setSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that event.");
    } finally {
      setQuickBusy(false);
    }
  };

  const handleSave = async (patch: GCalEventInput, isNew: boolean) => {
    if (isNew) await gcal.createEvent(patch);
    else if (editing?.googleId) await gcal.updateEvent(editing.googleId, patch);
    setEditorOpen(false);
    setEditing(null);
    await loadEvents(visibleCalendarIds, search.trim());
  };

  const handleDeleteFromEditor = async () => {
    if (editing?.googleId) {
      await gcal.deleteEvent(editing.googleId, editing.calendarId || "primary");
    } else if (editing?.localId) {
      onDeleteEvent(editing.localId);
    }
    setEditorOpen(false);
    setEditing(null);
    await loadEvents(visibleCalendarIds, search.trim());
  };

  const handleRsvp = async (event: UnifiedEvent, response: "accepted" | "declined" | "tentative") => {
    if (!event.googleId) return;
    setBusyKey(event.key);
    try {
      await gcal.respond(event.googleId, event.calendarId || "primary", response);
      await loadEvents(visibleCalendarIds, search.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your RSVP.");
    } finally {
      setBusyKey("");
    }
  };

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEvent = (event: UnifiedEvent) => {
    if (event.localId) return; // Daisy-only events are managed from the agent
    setEditing(event);
    setEditorOpen(true);
  };

  const myRsvp = (event: UnifiedEvent) => event.attendees.find((a) => a.self)?.responseStatus || "";

  return (
    <div className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600 shadow-sm">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">Calendar</h1>
            <p className="text-xs text-zinc-500 font-medium">
              {googleConnected ? "Synced with Google Calendar" : "Connect Google to see your schedule"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events"
              className="w-44 bg-zinc-50 border border-zinc-200 rounded-full pl-8 pr-7 py-1.5 text-xs font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-blue-400 focus:bg-white transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-[11px] font-bold text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 cursor-pointer transition-colors"
          >
            Today
          </button>

          <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 p-1 rounded-full">
            <button
              onClick={() => shiftMonth(-1)}
              className="p-1.5 hover:bg-white rounded-full text-zinc-500 hover:text-zinc-900 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-extrabold px-2 text-zinc-700 min-w-[104px] text-center">
              {monthLabel(cursor.year, cursor.month)}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              className="p-1.5 hover:bg-white rounded-full text-zinc-500 hover:text-zinc-900 cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {googleConnected && (
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-bold cursor-pointer transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" /> New
            </button>
          )}
        </div>
      </div>

      {/* Connection bar */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-white/60 border border-white/70 rounded-2xl px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              googleConnected ? "bg-emerald-500" : "bg-zinc-300"
            }`}
          />
          <div className="min-w-0">
            <p className="text-xs font-bold text-zinc-700 truncate">
              {googleConnected ? "Google Calendar connected" : "Google Calendar not connected"}
            </p>
            <p className="text-[10px] text-zinc-400 truncate">
              {error || googleError
                ? error || googleError
                : googleConnected
                ? googleLastSync
                  ? `${calendars.length} calendar${calendars.length === 1 ? "" : "s"} · last synced ${googleLastSync}`
                  : `${calendars.length} calendar${calendars.length === 1 ? "" : "s"}`
                : "Connect to pull your real events into Daisy."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {googleConnected ? (
            <>
              <button
                onClick={refresh}
                disabled={googleSyncing || loading}
                className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-600 hover:text-zinc-900 disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${googleSyncing || loading ? "animate-spin" : ""}`} />
                {googleSyncing || loading ? "Syncing…" : "Sync now"}
              </button>
              <button
                onClick={onGoogleDisconnect}
                className="text-[11px] font-bold text-zinc-500 hover:text-rose-600 cursor-pointer"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={onGoogleConnect}
              className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95 cursor-pointer"
            >
              <LinkIcon className="w-3 h-3" /> Connect Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0">
        {/* Month grid */}
        <div className="lg:col-span-8 flex flex-col bg-white border border-zinc-200/70 rounded-[28px] p-4 md:p-5 min-h-[460px] lg:h-full lg:min-h-0 shadow-sm">
          <div className="grid grid-cols-7 text-center font-bold text-[10px] text-zinc-400 uppercase tracking-widest mb-2">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-0 auto-rows-fr">
            {cells.map(({ date, inMonth }) => {
              const dayEvents = eventsByDay.get(date) || [];
              const isToday = date === today;
              const isSelected = date === selectedDate;
              const dayNumber = Number(date.slice(8, 10));

              return (
                <motion.button
                  key={date}
                  whileHover={{ scale: 1.015 }}
                  onClick={() => setSelectedDate(date)}
                  onDoubleClick={() => {
                    setSelectedDate(date);
                    if (googleConnected) openNew();
                  }}
                  className={`text-left p-1.5 rounded-2xl border flex flex-col gap-1 transition-all cursor-pointer overflow-hidden min-h-[58px] ${
                    isSelected
                      ? "bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/15"
                      : isToday
                      ? "bg-white border-blue-300"
                      : inMonth
                      ? "bg-white border-zinc-200/70 hover:border-zinc-300"
                      : "bg-zinc-50/60 border-transparent"
                  }`}
                >
                  <span
                    className={`text-[11px] font-bold leading-none flex items-center gap-1 ${
                      isToday
                        ? "text-white bg-blue-600 rounded-full w-5 h-5 justify-center"
                        : inMonth
                        ? "text-zinc-700"
                        : "text-zinc-300"
                    }`}
                  >
                    {dayNumber}
                  </span>

                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {dayEvents.slice(0, 3).map((e) => (
                      <span
                        key={e.key}
                        title={e.title}
                        className="flex items-center gap-1 min-w-0"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: e.color }}
                        />
                        <span className="text-[9px] font-semibold text-zinc-600 truncate leading-tight">
                          {e.allDay ? e.title : `${formatClock(e.start.slice(11))} ${e.title}`}
                        </span>
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[8px] font-bold text-zinc-400 pl-2.5">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Calendar visibility */}
          {calendars.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-1.5">
              {calendars.map((c) => {
                const on = !hidden.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCalendar(c.id)}
                    title={c.canEdit ? c.summary : `${c.summary} (read-only)`}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all cursor-pointer max-w-[190px] ${
                      on
                        ? "bg-white border-zinc-200 text-zinc-700"
                        : "bg-zinc-50 border-transparent text-zinc-400"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 border"
                      style={{
                        backgroundColor: on ? c.backgroundColor : "transparent",
                        borderColor: c.backgroundColor,
                      }}
                    />
                    <span className="truncate">{c.summary}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Day agenda */}
        <div className="lg:col-span-4 flex flex-col bg-white border border-zinc-200/70 rounded-[28px] p-5 min-h-[380px] lg:h-full lg:min-h-0 shadow-sm">
          <div className="mb-3 flex-shrink-0">
            <h3 className="text-sm font-extrabold text-zinc-800">
              {selectedDate === today ? "Today" : parseDay(selectedDate).toLocaleDateString(undefined, { weekday: "long" })}
            </h3>
            <p className="text-[11px] text-zinc-500 font-medium">{formatLongDate(selectedDate)}</p>
          </div>

          {googleConnected && (
            <form onSubmit={handleQuickAdd} className="mb-3 flex-shrink-0">
              <div className="relative">
                <Sparkles className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                <input
                  value={quickAdd}
                  onChange={(e) => setQuickAdd(e.target.value)}
                  placeholder='Try "Lunch Friday at 1pm"'
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-full pl-8 pr-9 py-2 text-[11px] font-medium text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400 focus:bg-white transition-colors"
                />
                <button
                  type="submit"
                  disabled={quickBusy || !quickAdd.trim()}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-zinc-900 text-white disabled:opacity-30 disabled:cursor-default cursor-pointer transition-all active:scale-90"
                >
                  {quickBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3 stroke-[3]" />
                  )}
                </button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0">
            <AnimatePresence mode="popLayout">
              {selectedEvents.length > 0 ? (
                selectedEvents.map((e) => {
                  const rsvp = myRsvp(e);
                  const repeat = describeRecurrence(e.recurrence);
                  return (
                    <motion.div
                      key={e.key}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      onClick={() => openEvent(e)}
                      className={`group relative p-3 pl-4 rounded-2xl border bg-white hover:border-zinc-300 hover:shadow-sm transition-all overflow-hidden ${
                        e.localId ? "border-zinc-200" : "border-zinc-200 cursor-pointer"
                      } ${e.completed ? "opacity-60" : ""}`}
                    >
                      {/* Calendar colour spine */}
                      <span
                        className="absolute left-0 top-0 bottom-0 w-1.5"
                        style={{ backgroundColor: e.color }}
                      />

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4
                              className={`text-xs font-bold text-zinc-800 leading-snug ${
                                e.completed ? "line-through" : ""
                              }`}
                            >
                              {e.title}
                            </h4>
                            {repeat && (
                              <span className="inline-flex items-center gap-0.5 text-[8.5px] font-extrabold uppercase text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
                                <Repeat className="w-2.5 h-2.5" /> {repeat}
                              </span>
                            )}
                            {e.readOnly && (
                              <span className="text-[8.5px] font-extrabold uppercase text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-md">
                                Read-only
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-1 text-[10px] font-semibold text-zinc-500">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span>
                              {e.allDay
                                ? "All day"
                                : `${formatClock(e.start.slice(11))} – ${formatClock(e.end.slice(11))}`}
                            </span>
                          </div>

                          {e.location && (
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] font-medium text-zinc-500 min-w-0">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{e.location}</span>
                            </div>
                          )}

                          {e.attendees.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] font-medium text-zinc-500">
                              <Users className="w-3 h-3 flex-shrink-0" />
                              <span>
                                {e.attendees.length} guest{e.attendees.length === 1 ? "" : "s"}
                                {(() => {
                                  const yes = e.attendees.filter((a) => a.responseStatus === "accepted").length;
                                  return yes ? ` · ${yes} yes` : "";
                                })()}
                              </span>
                            </div>
                          )}

                          {!e.reminders.useDefault && e.reminders.overrides[0] && (
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] font-medium text-zinc-400">
                              <Bell className="w-3 h-3 flex-shrink-0" />
                              <span>{e.reminders.overrides[0].minutes} min before</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[9px] font-bold text-zinc-400 truncate max-w-[130px]">
                              {e.calendarName}
                            </span>
                            {e.meetLink && (
                              <a
                                href={e.meetLink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(ev) => ev.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[9px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md hover:bg-emerald-100 cursor-pointer"
                              >
                                <Video className="w-2.5 h-2.5" /> Join
                              </a>
                            )}
                            {e.htmlLink && (
                              <a
                                href={e.htmlLink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(ev) => ev.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-zinc-700 cursor-pointer"
                              >
                                <ExternalLink className="w-2.5 h-2.5" /> Google
                              </a>
                            )}
                          </div>
                        </div>

                        {e.localId && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onToggleComplete(e.localId!);
                              }}
                              className="p-1 cursor-pointer"
                              title="Mark done"
                            >
                              {e.completed ? (
                                <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                                </span>
                              ) : (
                                <span className="w-4 h-4 rounded-full border-2 border-zinc-300 block" />
                              )}
                            </button>
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onDeleteEvent(e.localId!);
                              }}
                              className="p-1 text-zinc-300 hover:text-rose-500 cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* RSVP for invitations */}
                      {rsvp && rsvp !== "accepted" && (
                        <div
                          className="flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-100"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <span className="text-[9px] font-bold text-zinc-400 uppercase">Going?</span>
                          {(["accepted", "tentative", "declined"] as const).map((r) => (
                            <button
                              key={r}
                              disabled={busyKey === e.key}
                              onClick={() => handleRsvp(e, r)}
                              className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border cursor-pointer transition-colors disabled:opacity-40 ${
                                rsvp === r
                                  ? "bg-zinc-900 text-white border-zinc-900"
                                  : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                              }`}
                            >
                              {r === "accepted" ? "Yes" : r === "tentative" ? "Maybe" : "No"}
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-zinc-50 border border-zinc-200 flex items-center justify-center text-zinc-300 mb-3">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clock className="w-6 h-6" />}
                  </div>
                  <h4 className="text-xs font-bold text-zinc-700">
                    {loading ? "Loading…" : search ? "No matches" : "Nothing scheduled"}
                  </h4>
                  <p className="text-[10px] text-zinc-500 max-w-[210px] mt-1 font-medium leading-relaxed">
                    {search
                      ? "Try a different search term."
                      : googleConnected
                      ? "Add an event above, or ask Daisy to schedule it for you."
                      : "Connect Google Calendar to see your real schedule."}
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 flex-shrink-0">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => setError("")} className="ml-auto cursor-pointer hover:text-rose-900">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {editorOpen && (
        <EventEditor
          event={editing}
          defaultDate={selectedDate}
          calendars={calendars}
          colors={colors}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
          onDelete={editing ? handleDeleteFromEditor : undefined}
        />
      )}
    </div>
  );
}
