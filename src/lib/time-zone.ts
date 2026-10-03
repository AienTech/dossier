import "server-only";

import { cookies } from "next/headers";

import { TIME_ZONE_COOKIE } from "@/lib/greeting";

/**
 * The browser's time zone as it last told the server (the dashboard's
 * greeting keeps it in a cookie), for showing times the user picked, such as
 * an interview (E9-9). Undefined when unknown: then the server's own is used.
 */
export async function userTimeZone(): Promise<string | undefined> {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  if (!value) return undefined;
  try {
    const zone = decodeURIComponent(value);
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}
