import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

import { APPLY_PACKET_PASSWORD_HEADER, APPLY_PACKET_PASSWORD_PARAM } from "@/lib/apply-packet-url";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether this deployment accepts a shared password for apply-packet downloads. */
export function applyPacketPasswordConfigured(expected = env.HIREME_APPLY_PACKET_PASSWORD): boolean {
  return Boolean(expected);
}

/** The configured password for bot ZIP links, or undefined when unset. */
export function applyPacketPassword(expected = env.HIREME_APPLY_PACKET_PASSWORD): string | undefined {
  return expected || undefined;
}

/**
 * Whether the request carries the apply-packet password (query or header).
 * Never true when HIREME_APPLY_PACKET_PASSWORD is unset.
 */
export function isApplyPacketPassword(
  request: Request,
  expected = env.HIREME_APPLY_PACKET_PASSWORD,
): boolean {
  if (!expected) return false;
  const url = new URL(request.url);
  const given =
    url.searchParams.get(APPLY_PACKET_PASSWORD_PARAM) ||
    request.headers.get(APPLY_PACKET_PASSWORD_HEADER);
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
