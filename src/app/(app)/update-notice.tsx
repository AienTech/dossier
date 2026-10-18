"use client";

import { useId, useRef, useState } from "react";

import { toast } from "@/components/toast";
import { UPGRADE_GUIDE_URL, type Release } from "@/lib/releases";
import { dismissUpdate } from "@/lib/update-actions";

// Each at least 24 px high (WCAG 2.2 target size), however small the text.
const TARGET = "inline-flex min-h-6 items-center";
const LINK = `${TARGET} font-medium text-ink underline underline-offset-2`;

/**
 * The sidebar's notice while a newer release is out: what's new in it, how
 * to update, or "Not now", which hides it until a newer one still.
 */
export function UpdateNotice({ release, currentVersion }: { release: Release; currentVersion: string }) {
  const [hidden, setHidden] = useState(false);
  const notice = useRef<HTMLElement>(null);
  const titleId = useId();
  if (hidden) return null;

  const notNow = async () => {
    // Focus goes on to what follows the notice, rather than to the page.
    notice.current?.nextElementSibling?.querySelector<HTMLElement>("a[href], button")?.focus();
    setHidden(true);
    const result = await dismissUpdate({ version: release.version });
    if (!result.ok) {
      setHidden(false);
      toast(result.error);
    }
  };

  return (
    <section ref={notice} aria-labelledby={titleId} className="flex flex-col gap-1.5 rounded-control border border-line-card bg-card px-3 py-2.5">
      <h2 id={titleId} className="text-meta font-medium">
        Dossier {release.version} is out
      </h2>
      <p className="text-xs text-muted">You have {currentVersion}. Update to get its fixes and features.</p>
      <div className="flex flex-wrap gap-x-3 text-xs">
        <a href={release.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          What&apos;s new{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <a href={UPGRADE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          How to update{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <button type="button" onClick={() => void notNow()} className={`${TARGET} text-muted hover:text-ink`}>
          Not now
        </button>
      </div>
    </section>
  );
}
