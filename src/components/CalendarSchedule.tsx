import React, { useState } from "react";
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Plus, 
  Trash, 
  CheckSquare, 
  Square, 
  ChevronLeft, 
  ChevronRight, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  ListTodo, 
  AlertTriangle 
} from "lucide-react";
import { CalendarEvent } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface CalendarScheduleProps {
  events: CalendarEvent[];
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onUpdateEvent?: (event: CalendarEvent) => void;
}

export default function CalendarSchedule({
  events,
  onAddEvent,
  onDeleteEvent,
  onToggleComplete,
  onUpdateEvent,
}: CalendarScheduleProps) {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 6, 21)); // Set mock default date consistent with local time metadata (July 2026)
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventTime, setNewEventTime] = useState("12:00");
  const [newEventCategory, setNewEventCategory] = useState<"work" | "personal" | "health" | "media" | "ai">("work");
  const [newEventPriority, setNewEventPriority] = useState<"high" | "medium" | "low">("medium");
  const [selectedDay, setSelectedDay] = useState(21); // July 21, 2026

  // Subtask Interaction States
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [newSubtaskText, setNewSubtaskText] = useState<{ [eventId: string]: string }>({});

  // Helper arrays for calendar generation
  const daysInMonth = 31; // July has 31 days
  const startDayOfWeek = 3; // July 1, 2026 is a Wednesday (0=Sun, 1=Mon, 2=Tue, 3=Wed...)

  const handlePrevMonth = () => {
    // Keep it on July 2026 for simulation sandbox consistency
  };

  const handleNextMonth = () => {
    // Keep it on July 2026 for simulation sandbox consistency
  };

  const handleAddEventSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;

    // ISO formatted string
    const dayStr = selectedDay < 10 ? `0${selectedDay}` : `${selectedDay}`;
    const startISO = `2026-07-${dayStr}T${newEventTime}`;
    // Calculate 1 hour duration
    const [hours, mins] = newEventTime.split(":").map(Number);
    const endHours = (hours + 1) % 24;
    const endHoursStr = endHours < 10 ? `0${endHours}` : `${endHours}`;
    const endISO = `2026-07-${dayStr}T${endHoursStr}:${mins < 10 ? `0${mins}` : mins}`;

    // Auto-generate 3 category-specific checklist subtasks for detailed complexity!
    let defaultSubtasks: Array<{ id: string; text: string; completed: boolean }> = [];
    if (newEventCategory === "work") {
      defaultSubtasks = [
        { id: "s1", text: "Analyze specs & key details", completed: false },
        { id: "s2", text: "Draft strategic action items", completed: false },
        { id: "s3", text: "Verify results safety checklist", completed: false },
      ];
    } else if (newEventCategory === "personal") {
      defaultSubtasks = [
        { id: "s1", text: "De-clutter physical/digital desk", completed: false },
        { id: "s2", text: "Map focus schedule milestones", completed: false },
        { id: "s3", text: "Backup files & lock environment", completed: false },
      ];
    } else if (newEventCategory === "health") {
      defaultSubtasks = [
        { id: "s1", text: "Dynamic stretching & warm-up", completed: false },
        { id: "s2", text: "Re-hydrate session (500ml H2O)", completed: false },
        { id: "s3", text: "Calm breathing & cooldown loops", completed: false },
      ];
    } else if (newEventCategory === "media") {
      defaultSubtasks = [
        { id: "s1", text: "Preset audio synth parameters", completed: false },
        { id: "s2", text: "Adjust sweepable lowpass sweep", completed: false },
        { id: "s3", text: "Mute other distractive browser tabs", completed: false },
      ];
    } else { // AI category
      defaultSubtasks = [
        { id: "s1", text: "Initialize sandbox telemetry log", completed: false },
        { id: "s2", text: "Verify neural connection integrity", completed: false },
        { id: "s3", text: "Check offline containment sync", completed: false },
      ];
    }

    onAddEvent({
      title: newEventTitle,
      start: startISO,
      end: endISO,
      category: newEventCategory,
      description: "Custom sandbox agenda item",
      completed: false,
      priority: newEventPriority,
      subtasks: defaultSubtasks,
    });

    setNewEventTitle("");
  };

  // Subtask Action Handlers
  const handleToggleSubtask = (event: CalendarEvent, subtaskId: string) => {
    if (!onUpdateEvent) return;
    const subtasks = event.subtasks || [];
    const updated = subtasks.map((sub) =>
      sub.id === subtaskId ? { ...sub, completed: !sub.completed } : sub
    );
    onUpdateEvent({
      ...event,
      subtasks: updated,
    });
  };

  const handleRemoveSubtask = (event: CalendarEvent, subtaskId: string) => {
    if (!onUpdateEvent) return;
    const subtasks = event.subtasks || [];
    const updated = subtasks.filter((sub) => sub.id !== subtaskId);
    onUpdateEvent({
      ...event,
      subtasks: updated,
    });
  };

  const handleCreateSubtask = (event: CalendarEvent) => {
    if (!onUpdateEvent) return;
    const text = newSubtaskText[event.id]?.trim();
    if (!text) return;

    const newSub = {
      id: crypto.randomUUID(),
      text,
      completed: false,
    };

    onUpdateEvent({
      ...event,
      subtasks: [...(event.subtasks || []), newSub],
    });

    setNewSubtaskText({ ...newSubtaskText, [event.id]: "" });
  };

  // Get active agenda for selected day
  const getEventsForDay = (day: number) => {
    const dayStr = day < 10 ? `2026-07-0${day}` : `2026-07-${day}`;
    return events.filter((e) => e.start.startsWith(dayStr));
  };

  const selectedDayEvents = getEventsForDay(selectedDay);

  const getCategoryColor = (cat?: string) => {
    switch (cat) {
      case "work":
        return "bg-blue-50/75 border-blue-100 text-blue-800";
      case "personal":
        return "bg-pink-50/75 border-pink-100 text-pink-800";
      case "health":
        return "bg-emerald-50/75 border-emerald-100 text-emerald-800";
      case "media":
        return "bg-purple-50/75 border-purple-100 text-purple-800";
      case "ai":
        return "bg-amber-50/75 border-amber-100 text-amber-800";
      default:
        return "bg-zinc-50/75 border-zinc-100 text-zinc-800";
    }
  };

  const getPriorityBadge = (p?: "high" | "medium" | "low") => {
    switch (p) {
      case "high":
        return (
          <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded-md border border-rose-100 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            High
          </span>
        );
      case "low":
        return (
          <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-md border border-emerald-100 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Low
          </span>
        );
      case "medium":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md border border-amber-100 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Med
          </span>
        );
    }
  };

  return (
    <div id="calendar_schedule_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600 shadow-sm relative">
            <CalendarIcon className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">
              Daisy Calendar Sync
            </h1>
            <p className="text-xs text-zinc-500 font-medium">Beautifully coordinated daily flow agenda 🌸</p>
          </div>
        </div>

        {/* Navigation Indicator */}
        <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 p-1.5 rounded-2xl shadow-sm">
          <button onClick={handlePrevMonth} className="p-1 hover:bg-white rounded-lg text-zinc-500 hover:text-zinc-800 cursor-pointer transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-extrabold font-mono px-2 text-zinc-700">
            JULY 2026
          </span>
          <button onClick={handleNextMonth} className="p-1 hover:bg-white rounded-lg text-zinc-500 hover:text-zinc-800 cursor-pointer transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        {/* Left Column: Calendar Grid (lg:col-span-7) */}
        <div className="lg:col-span-7 flex flex-col bg-zinc-50/80 border border-zinc-200/60 rounded-[28px] p-4 md:p-6 min-h-[420px] lg:h-full lg:min-h-0 shadow-inner justify-between gap-4">
          <div>
            {/* Days of week */}
            <div className="grid grid-cols-7 text-center font-bold text-[10px] text-zinc-400 uppercase tracking-widest mb-3">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Monthly grid */}
            <div className="grid grid-cols-7 gap-1.5">
              {/* Pre-fill empty days offset */}
              {Array.from({ length: startDayOfWeek }).map((_, idx) => (
                <div key={`offset-${idx}`} className="h-12 sm:h-14 p-1 opacity-20" />
              ))}

              {/* Real July Days */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const isToday = day === 21; // Match metadata current time date (July 21)
                const isSelected = day === selectedDay;
                const dayEvents = getEventsForDay(day);

                return (
                  <motion.div
                    key={`day-${day}`}
                    whileHover={{ scale: 1.02 }}
                    onClick={() => setSelectedDay(day)}
                    className={`h-12 sm:h-14 p-1.5 rounded-2xl border flex flex-col justify-between transition-all cursor-pointer relative group ${
                      isSelected
                        ? "bg-white border-blue-400 shadow-md ring-2 ring-blue-400/10 text-zinc-900"
                        : isToday
                        ? "bg-blue-50/70 border border-blue-400 text-blue-700 font-extrabold"
                        : "bg-white/80 border-zinc-200/60 hover:bg-white hover:border-zinc-300 text-zinc-700"
                    }`}
                  >
                    <span className="text-xs font-mono font-bold flex items-center">
                      {day}
                      {isToday && (
                        <span className="inline-block ml-1 w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />
                      )}
                    </span>

                    {/* Miniature event indicator blobs */}
                    <div className="flex gap-0.5 flex-wrap max-h-5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className={`w-1.5 h-1.5 rounded-full ${
                            e.category === "work"
                              ? "bg-blue-400"
                              : e.category === "personal"
                              ? "bg-pink-400"
                              : e.category === "health"
                              ? "bg-emerald-400"
                              : e.category === "media"
                              ? "bg-purple-400"
                              : "bg-amber-400"
                          }`}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[7px] font-mono leading-none text-zinc-400">
                          +{dayEvents.length - 3}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Quick Scheduler form footer */}
          <form
            onSubmit={handleAddEventSubmit}
            className="mt-2 pt-4 border-t border-zinc-200/60 flex flex-col gap-3.5"
          >
            <div className="w-full space-y-1">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                Schedule Event (July {selectedDay}, 2026)
              </label>
              <input
                type="text"
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder="Meeting, session, exercise..."
                className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-400 text-zinc-800 placeholder-zinc-400 shadow-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex-1 min-w-[80px]">
                <input
                  type="time"
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-2 py-1.5 text-xs text-center text-zinc-800 focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="flex-1 min-w-[90px]">
                <select
                  value={newEventCategory}
                  onChange={(e: any) => setNewEventCategory(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:border-blue-400 cursor-pointer font-bold"
                >
                  <option value="work">💼 Work</option>
                  <option value="personal">🏡 Personal</option>
                  <option value="health">🍀 Health</option>
                  <option value="media">🎵 Media</option>
                  <option value="ai">🤖 AI Sync</option>
                </select>
              </div>

              <div className="flex-1 min-w-[90px]">
                <select
                  value={newEventPriority}
                  onChange={(e: any) => setNewEventPriority(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:border-blue-400 cursor-pointer font-bold"
                >
                  <option value="high">🔴 High</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="low">🟢 Low</option>
                </select>
              </div>

              <button
                type="submit"
                className="px-3 py-1.5 bg-gradient-to-r from-blue-400 to-indigo-500 hover:from-blue-500 hover:to-indigo-600 text-white rounded-xl cursor-pointer flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all h-9"
              >
                <Plus className="w-4 h-4 stroke-[3] mr-1" />
                <span className="text-[10px] font-extrabold uppercase">Add</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Timeline Agenda (lg:col-span-5) */}
        <div className="lg:col-span-5 flex flex-col bg-white border border-zinc-150 rounded-[28px] p-5 md:p-6 min-h-[350px] lg:h-full lg:min-h-0 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-extrabold text-zinc-800">Agenda Timeline</h3>
            <p className="text-xs text-zinc-500 font-medium">
              July {selectedDay}, 2026 agenda checklist
            </p>
          </div>

          {/* Agenda items list */}
          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
            <AnimatePresence>
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map((e) => {
                    const subtasks = e.subtasks || [];
                    const completedSubs = subtasks.filter(s => s.completed).length;
                    const totalSubs = subtasks.length;
                    const subProgressPct = totalSubs > 0 ? (completedSubs / totalSubs) * 100 : 0;
                    const isExpanded = expandedEventId === e.id;

                    return (
                      <motion.div
                        key={e.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className={`p-3.5 rounded-2xl border flex flex-col gap-2 shadow-sm relative overflow-hidden transition-all duration-200 ${getCategoryColor(
                          e.category
                        )}`}
                      >
                        {/* Event main row layout */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            {/* Completion checkbox toggler */}
                            <button
                              onClick={() => onToggleComplete(e.id)}
                              className="flex-shrink-0 cursor-pointer mt-0.5 focus:outline-none"
                            >
                              {e.completed ? (
                                <div className="w-4.5 h-4.5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                  <Check className="w-3 h-3 stroke-[3]" />
                                </div>
                              ) : (
                                <div className="w-4.5 h-4.5 rounded-full border-2 border-zinc-300 hover:border-zinc-400 bg-white" />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <h4
                                  className={`text-xs font-bold leading-snug truncate ${
                                    e.completed ? "line-through opacity-50 text-zinc-400" : "text-zinc-800"
                                  }`}
                                >
                                  {e.title}
                                </h4>
                                {getPriorityBadge(e.priority)}
                              </div>
                              
                              <div className="flex items-center gap-1.5 mt-1 text-[9px] font-semibold text-zinc-500">
                                <Clock className="w-3 h-3" />
                                <span>
                                  {e.start.split("T")[1]} - {e.end.split("T")[1]}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => onDeleteEvent(e.id)}
                            className="text-zinc-400 hover:text-rose-500 cursor-pointer transition-colors p-1"
                          >
                            <Trash className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Collapsed view checklist mini bar progress */}
                        {totalSubs > 0 && (
                          <div className="w-full mt-1">
                            <div className="flex justify-between items-center text-[8.5px] font-extrabold text-zinc-400 uppercase tracking-wider">
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setExpandedEventId(isExpanded ? null : e.id);
                                }}
                                className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                              >
                                <ListTodo className="w-3 h-3 text-indigo-500" />
                                <span>Subtasks ({completedSubs}/{totalSubs})</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                              <span>{Math.round(subProgressPct)}% done</span>
                            </div>
                            <div className="h-1 bg-zinc-200/80 rounded-full overflow-hidden mt-1.5">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-indigo-500 rounded-full transition-all duration-300"
                                style={{ width: `${subProgressPct}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Expanded subtask details dashboard */}
                        {isExpanded && totalSubs > 0 && (
                          <div className="mt-2.5 pt-2.5 border-t border-zinc-200/50 space-y-2">
                            {subtasks.map((sub) => (
                              <div key={sub.id} className="flex items-center justify-between gap-2 pl-1 bg-white/45 p-1.5 rounded-lg border border-zinc-150/40">
                                <button
                                  onClick={() => handleToggleSubtask(e, sub.id)}
                                  className="flex items-center gap-2 text-left min-w-0 cursor-pointer focus:outline-none flex-1"
                                >
                                  {sub.completed ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-500 shrink-0" />
                                  )}
                                  <span className={`text-[10px] font-bold leading-tight truncate ${sub.completed ? "line-through text-zinc-400 opacity-60 font-medium" : "text-zinc-700"}`}>
                                    {sub.text}
                                  </span>
                                </button>
                                <button
                                  onClick={() => handleRemoveSubtask(e, sub.id)}
                                  className="text-zinc-300 hover:text-rose-500 text-[10px] p-0.5 cursor-pointer leading-none font-bold"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}

                            {/* Inline quick append custom subtask form */}
                            <div className="flex items-center gap-1.5 mt-2">
                              <input
                                type="text"
                                placeholder="Add custom step..."
                                value={newSubtaskText[e.id] || ""}
                                onChange={(ev) => setNewSubtaskText({ ...newSubtaskText, [e.id]: ev.target.value })}
                                onKeyDown={(ev) => {
                                  if (ev.key === "Enter") {
                                    ev.preventDefault();
                                    handleCreateSubtask(e);
                                  }
                                }}
                                className="flex-1 bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-[10px] focus:outline-none focus:border-indigo-400 text-zinc-800 placeholder-zinc-400 font-medium"
                              />
                              <button
                                type="button"
                                onClick={() => handleCreateSubtask(e)}
                                className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 border border-zinc-250 rounded-lg text-[9.5px] font-extrabold text-zinc-600 cursor-pointer transition-all"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center py-12">
                  <div className="w-12 h-12 rounded-full bg-zinc-50 border border-zinc-200 flex items-center justify-center text-zinc-300 mb-3">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h4 className="text-xs font-bold text-zinc-700">No events logged</h4>
                  <p className="text-[10px] text-zinc-500 max-w-xs px-4 mt-1 font-medium leading-relaxed">
                    Select a day or request DAISY to schedule your sessions automatically.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
