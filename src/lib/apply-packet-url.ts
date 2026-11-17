/** Query param bots use when HIREME_APPLY_PACKET_PASSWORD is set. */
export const APPLY_PACKET_PASSWORD_PARAM = "password";

/** Header alternative for scripted downloads (same password as the query param). */
export const APPLY_PACKET_PASSWORD_HEADER = "x-hireme-apply-packet-password";

/** Relative ZIP path, with `?password=` when a bot password is configured. */
export function applyPacketPath(applicationId: string, password?: string | null): string {
  const path = `/api/apply-packets/${encodeURIComponent(applicationId)}`;
  if (!password) return path;
  return `${path}?${APPLY_PACKET_PASSWORD_PARAM}=${encodeURIComponent(password)}`;
}

/** Absolute ZIP URL for bot prompts and packet files. */
export function applyPacketUrl(origin: string, applicationId: string, password?: string | null): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${applyPacketPath(applicationId, password)}`;
}
