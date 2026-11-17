"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { setupSummary, type SetupItem } from "@/lib/setup-status";
import { SettingsSectionIntro } from "./settings-screen";

export function SetupSection({ items }: { items: SetupItem[] }) {
  const router = useRouter();
  const summary = setupSummary(items);
  return <>
    <SettingsSectionIntro title="Setup & health">Configure HireMe in one place. Review each capability, fix missing settings, and come back here to check progress.</SettingsSectionIntro>
    <Card className="space-y-3">
      <p className="text-lg font-medium">{summary.requiredReady} of {summary.requiredTotal} required checks configured</p>
      <p className="text-sm text-muted">{summary.ready} configured · {summary.attention} need attention. Optional integrations can be left off.</p>
      <p className="text-sm text-muted">“Configured” checks saved settings and permissions. It does not prove that an API key, quota or external service is working. Run the connection test in the linked settings section. Only checks explicitly labelled “Live check” contacted that service.</p>
      <Button variant="secondary" size="sm" onClick={() => router.refresh()}>Refresh checks</Button>
    </Card>
    <div className="space-y-3">
      {items.map(item => <Card key={item.id} className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{item.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs ${item.status === "attention" ? "bg-red-100 text-red-800" : item.status === "ready" ? "bg-green-100 text-green-800" : "bg-track text-muted"}`}>
              {item.status === "ready" ? item.verification === "live" ? "Live check passed" : "Configured" : item.status === "attention" ? "Needs attention" : item.status === "disabled" ? "Off" : "Optional"}
            </span>
            <span className="text-xs text-muted">{item.required ? "Required" : "Optional"}</span>
          </div>
          <p className="text-sm text-muted">{item.detail}</p>
        </div>
        <Link href={item.href} aria-label={`${item.status === "ready" ? "Review settings" : "Configure"} ${item.title}`} className={buttonClassName("secondary", "sm")}>{item.status === "ready" ? "Review settings" : "Configure"}<span className="sr-only"> {item.title}</span></Link>
      </Card>)}
    </div>
    <Card id="server-configuration" className="space-y-2">
      <h3 className="font-medium">Server configuration</h3>
      <p className="text-sm text-muted">Database connections, the public site address and cloud worker credentials are configured in your hosting environment, then applied by redeploying. Their values are never displayed here.</p>
      <p className="text-sm text-muted">Database: DATABASE_URL and the direct DATABASE_URL_UNPOOLED. Hosted address: HIREME_PUBLIC_URL. Vercel worker control: HIREME_WORKER_VERCEL_TOKEN. Bot ZIP downloads without sign-in: HIREME_APPLY_PACKET_PASSWORD. Google OAuth credentials can be saved in Settings → Google.</p>
    </Card>
  </>;
}
