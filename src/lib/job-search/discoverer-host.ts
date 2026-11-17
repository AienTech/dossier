/** Hosts that speak the local discoverer’s company / scrape APIs. Safe for client + server. */
export function isLocalDiscovererHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.startsWith("127.0.0.1") || h.startsWith("localhost") || h.startsWith("[::1]") || h.startsWith("host.docker.internal");
}

export type DiscovererCompany = {
  id: string;
  name: string;
  ats: string;
  slug: string;
  url: string;
};

export type DiscovererProgress = {
  run_id?: string;
  status: string;
  started_at: string | null;
  updated_at?: string;
  finished_at: string | null;
  current: string | null;
  message: string;
  total: number;
  done: number;
  failed: number;
  pending: number;
  percent: number;
  can_resume: boolean;
  companies: Array<{
    id: string;
    name: string;
    status: string;
    jobs: number;
    error: string | null;
    finished_at: string | null;
  }>;
};
