import { after } from "next/server";

import { verifySession } from "@/lib/auth/session";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { checkForUpdatesDaily, updateNotice } from "@/lib/update-check";
import { notePageLoad } from "@/lib/usage-ping";
import { appVersion } from "@/lib/version";

import { Sidebar } from "./sidebar";

/**
 * The signed-in shell: sidebar on the left, the screen on the right. Routes
 * outside the (app) group, such as /login, render without it. Every page
 * inside needs a session.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Proxy already redirects signed-out visitors; this is the check next to the data.
  await verifySession();
  // The day's usage ping and update check, if they haven't run yet: after the page, so they never slow one down.
  after(notePageLoad);
  after(checkForUpdatesDaily);

  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const userName = name.trim() || "New user";

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-on-primary hover:text-on-primary focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar userName={userName} update={updateNotice(settings)} currentVersion={appVersion} />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col focus:outline-none">
        {children}
      </main>
    </div>
  );
}
