"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { ActionError, publicAction } from "@/lib/action";
import { clientIp } from "@/lib/auth/client-ip";
import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { safeNextPath } from "@/lib/auth/next-path";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { loginMessages } from "./messages";

/**
 * Signs in with the password from DOSSIER_PASSWORD (PRD AUTH-1, AUTH-4).
 * Failed attempts are rate-limited per IP and globally (AUTH-5). Returns
 * where to go next: the requested page if it's on this site, or the dashboard.
 */
export const signIn = publicAction(
  z.object({
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ password, remember, next }, { toast }) => {
    const ip = clientIp(await headers());
    const wait = await loginWaitMs(prisma, ip);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    if (!password) throw new ActionError(loginMessages.empty);
    if (!passwordMatches(password)) {
      await recordLoginFailure(prisma, ip);
      throw new ActionError(loginMessages.wrong);
    }
    await recordLoginSuccess(prisma, ip);

    await startSession({ persistent: remember });
    const firstName = (await loadProfileName()).trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);
