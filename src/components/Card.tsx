import React from "react";

/**
 * The shared card surface used across the dashboard, inbox and workspace lists.
 *
 * The look is deliberately flat — a solid white ground, a hairline border and a
 * tight two-layer shadow — rather than the translucent glass used elsewhere in
 * the shell. Glass reads well behind the hero, but stacked in a grid it muddies
 * text and makes the edges disappear, so content surfaces sit on their own.
 */

type Accent = "amber" | "emerald" | "rose" | "blue" | "zinc";

/** Badge colours per accent. Kept as whole class strings so Tailwind can see them. */
const ACCENT_ICON: Record<Accent, string> = {
  amber: "text-amber-600",
  emerald: "text-emerald-600",
  rose: "text-rose-600",
  blue: "text-blue-600",
  zinc: "text-zinc-600",
};

/** Two shadows: a 1px contact edge, then a soft ambient lift. */
const SHADOW =
  "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_20px_-8px_rgba(16,24,40,0.10)]";

export function Card({
  children,
  className = "",
  interactive = false,
  selected = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Adds hover/active affordances. Use for cards that are themselves clickable. */
  interactive?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className={[
        "relative bg-white rounded-[22px] border",
        selected ? "border-zinc-900/15 ring-1 ring-zinc-900/10" : "border-zinc-200/90",
        SHADOW,
        interactive
          ? "transition-all cursor-pointer hover:border-zinc-300 hover:shadow-[0_1px_2px_rgba(16,24,40,0.05),0_12px_28px_-10px_rgba(16,24,40,0.16)] active:scale-[0.995]"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The circular icon chip that straddles the card's top edge. Absolutely
 * positioned so it sits half outside the border — pair it with `pt-8` on the
 * card's content so the title clears it.
 */
export function CardBadge({
  icon: Icon,
  accent = "zinc",
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
}) {
  return (
    <span
      aria-hidden
      className="absolute -top-4 left-5 w-9 h-9 rounded-full bg-white border border-zinc-200 shadow-[0_1px_3px_rgba(16,24,40,0.10)] flex items-center justify-center"
    >
      <Icon className={`w-4 h-4 ${ACCENT_ICON[accent]}`} />
    </span>
  );
}

/** Bold title, with an optional muted count sitting beside it. */
export function CardTitle({
  children,
  count,
  className = "",
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900 truncate">
        {children}
      </h3>
      {count != null && (
        <span className="text-[13px] font-medium text-zinc-400 shrink-0">{count}</span>
      )}
    </div>
  );
}

/** Relaxed grey body copy. */
export function CardBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[13px] leading-relaxed text-zinc-500 ${className}`}>{children}</p>
  );
}

/** The bordered, neutral action button anchored at the card's bottom-left. */
export function CardAction({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-[10px] border border-zinc-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-800 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-all hover:bg-zinc-50 hover:border-zinc-400 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
