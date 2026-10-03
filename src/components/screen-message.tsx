import type { ReactNode } from "react";

/**
 * A calm message in place of a screen (E11-4): something isn't there, or it
 * didn't load. Says what happened, then what to do next.
 */
export function ScreenMessage({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section className="flex max-w-[680px] flex-col items-start gap-3 px-14 pt-12 pb-16">
      <h1 className="font-serif text-title text-pretty">{title}</h1>
      <div className="flex flex-col gap-2 text-lead text-pretty text-muted">{children}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">{actions}</div>
    </section>
  );
}
