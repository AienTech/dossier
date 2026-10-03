import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The top of an application's page (APP-1): breadcrumb, title, the meta
 * line, the actions on the right (status, downloads) and, below, the tabs.
 */
export function ApplicationHeader({
  title,
  company,
  meta,
  actions,
  children,
}: {
  title: string;
  company: string;
  /** Location, work mode, salary, deadline, created: whichever are known. */
  meta: string[];
  actions: ReactNode;
  /** The tab list, drawn on the header's bottom line. */
  children?: ReactNode;
}) {
  const name = title.trim() || "Untitled application";
  return (
    <header className="flex flex-col gap-[18px] border-b border-line px-14 pt-9">
      <nav aria-label="Breadcrumb">
        <ol className="flex gap-1.5 text-meta text-muted">
          <li>
            <Link href="/applications" className="text-muted hover:text-ink">
              Applications
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">
            {company.trim() || name}
          </li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2.5">
          <h1 className="font-serif text-[34px] leading-[1.15] tracking-[-0.015em] text-pretty">{name}</h1>
          {meta.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted">
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      </div>
      {children}
    </header>
  );
}
