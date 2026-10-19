"use client";

import Link from "next/link";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";

/** An event's line in a day is 24px, the smallest target allowed, with 2px between lines. */
const LINE = 24;
const GAP = 2;
/** Events a day has room for; three until it's measured. */
const LinesContext = createContext(3);

/**
 * The month's days, which share the screen's height. Measures the room one
 * day has for events, so each shows as many as fit.
 */
export function MonthGrid({ className, children }: { className: string; children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(3);
  useEffect(() => {
    // Every day has the same room: the rows share the height equally.
    const room = grid.current?.querySelector<HTMLElement>("[data-day-items]");
    if (!room) return;
    const observer = new ResizeObserver(() => setLines(Math.max(0, Math.floor((room.clientHeight + GAP) / (LINE + GAP)))));
    observer.observe(room);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={grid} className={className}>
      <LinesContext value={lines}>{children}</LinesContext>
    </div>
  );
}

/**
 * A day's date and the events it has room for. "+2 more", next to the date
 * so it doesn't take an event's line, opens its week for the rest.
 */
export function DayItems({ date, items, week }: { date: ReactNode; items: ReactNode[]; week: string }) {
  const lines = use(LinesContext);
  const hidden = Math.max(0, items.length - lines);
  return (
    <>
      <div className="flex items-center justify-between gap-1">
        {date}
        {hidden > 0 && (
          <Link href={week} className="inline-flex min-h-6 items-center px-1 text-xs whitespace-nowrap text-muted hover:text-ink">
            +{hidden} more
          </Link>
        )}
      </div>
      <ol data-day-items className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5">
        {items.slice(0, items.length - hidden)}
      </ol>
    </>
  );
}
