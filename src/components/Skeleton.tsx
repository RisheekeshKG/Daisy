import React from "react";
import { motion } from "motion/react";
import { DaisyMascotAvatar } from "./DaisyAgent";

/**
 * Loading placeholders.
 *
 * The rule this codebase follows: a surface that is *waiting* shows a skeleton
 * shaped like the content it will become; a surface that is *empty* shows an
 * empty state. Conflating the two is how "no notes yet" ends up looking like a
 * bug — the user cannot tell whether the app is still fetching or has nothing
 * to show.
 *
 * Skeletons mirror the real layout's dimensions so nothing shifts when the
 * content arrives.
 */

export function Skeleton({ className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={`animate-pulse rounded-lg bg-gradient-to-r from-zinc-200/60 via-zinc-100/80 to-zinc-200/60 ${className}`}
    />
  );
}

/** A few lines of fake text, last one short like a real paragraph. */
function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-2.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}


/** Mail list rows — mirrors sender / subject / snippet stacking. */
export function SkeletonMailList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" role="status" aria-label="Loading mail">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/40 bg-white/30 p-3 space-y-2"
          style={{ opacity: 1 - i * 0.11 }}
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2 w-10" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
      <span className="sr-only">Loading mail…</span>
    </div>
  );
}

/** Reading-pane placeholder while a message body is fetched. */
export function SkeletonMailBody() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading message">
      <Skeleton className="h-4 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-12" />
      </div>
      <div className="pt-3">
        <SkeletonText lines={7} />
      </div>
      <span className="sr-only">Loading message…</span>
    </div>
  );
}

/** Agenda rows — a coloured spine plus time and title, like a real event. */
export function SkeletonEventList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading calendar">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-stretch gap-2.5 rounded-2xl border border-white/40 bg-white/30 p-3"
          style={{ opacity: 1 - i * 0.13 }}
        >
          <Skeleton className="w-[3px] rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading calendar…</span>
    </div>
  );
}

/**
 * Quiet "refreshing behind the scenes" hint. Deliberately not a skeleton:
 * data is already on screen and replacing it would be a downgrade.
 */
export function RefreshingHint({ label = "Refreshing…" }: { label?: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-[10px] font-bold text-zinc-400"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      {label}
    </span>
  );
}

/**
 * Full-window boot screen, shown before the shell has anything real to render.
 *
 * Deliberately *not* a spinner that runs until every integration has answered:
 * Daisy's own data (notes, events, preferences) is local and hydrates almost
 * instantly, so gating the whole UI on a network probe would make a local-first
 * app feel slower than it is. This covers first paint only; anything that has
 * to go over the network gets a per-panel skeleton instead.
 */
export function BootSplash({ label = "Getting your workspace ready…" }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5
                 bg-gradient-to-tr from-amber-200/30 via-zinc-100/60 to-rose-200/30 backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <DaisyMascotAvatar className="w-20 h-20" />
      </motion.div>

      <div className="flex flex-col items-center gap-2.5">
        <p className="text-xs font-bold text-zinc-600 tracking-tight">{label}</p>
        <div className="h-1 w-40 rounded-full bg-white/60 overflow-hidden">
          <motion.div
            className="h-full w-1/3 rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
            animate={{ x: ["-120%", "360%"] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
