import { after } from "next/server";

import { verifySession } from "@/lib/auth/session";
import { loadProfileName } from "@/lib/profile-data";
import { notePageLoad } from "@/lib/usage-ping";

import { Sidebar } from "./sidebar";

/**
 * The signed-in shell: sidebar on the left, the screen on the right. Routes
 * outside the (app) group, such as /login, render without it. Every page
 * inside needs a session.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Proxy already redirects signed-out visitors; this is the check next to the data.
  await verifySession();
  // The day's usage ping, if it hasn't gone yet: after the page, so it never slows one down.
  after(notePageLoad);

  const userName = (await loadProfileName()).trim() || "New user";

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-on-primary hover:text-on-primary focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar userName={userName} />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col focus:outline-none">
        {children}
      </main>
    </div>
  );
}
