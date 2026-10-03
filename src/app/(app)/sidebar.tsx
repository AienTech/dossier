import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { appVersion } from "@/lib/version";

import { NavLinks } from "./nav-links";

/** The signed-in sidebar: product name, "+ New application", navigation and the account footer. */
export function Sidebar({ userName }: { userName: string }) {
  return (
    <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col gap-8 self-start overflow-y-auto border-r border-line bg-sidebar px-[18px] py-7">
      <div className="flex flex-col gap-0.5 px-2.5">
        <div className="font-serif text-2xl font-medium tracking-[-0.01em]">Dossier</div>
        <div className="text-xs text-muted">Your job search, on your server</div>
      </div>

      {/* Always a fresh start, whatever an open draft holds (E7-7). */}
        <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "-mb-3 justify-start px-3! hover:text-on-primary")}>
        + New application
      </Link>

      <NavLinks />

      <div className="mt-auto flex flex-col gap-1 border-t border-line px-2.5 pt-3.5">
        <div className="text-meta font-medium">{userName}</div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted">Self-hosted · v{appVersion}</span>
          <form action={signOut}>
            <button type="submit" className="text-xs text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
