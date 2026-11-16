"use server";
import { z } from "zod";
import { action, ActionError } from "@/lib/action";
import { loadDocuments } from "@/lib/application-documents";
import { applyBotSchema, APPLY_BOTS, applicationBotNotes } from "@/lib/application-bots";
import { applyCandidateContext, driveApplyPrompt } from "@/lib/drive-handoff";
import { driveSourceHash, parseDriveSync } from "@/lib/google/drive-sync";
import { loadGoogleAccount } from "@/lib/google/account";
import { applicationPacketName } from "@/lib/application-packet-name";
import { headers } from "next/headers";
import { env } from "@/lib/env";

export const previewBotPrompt = action(z.object({ id: z.string().min(1), bot: applyBotSchema, notes: z.string().max(2000).optional(), template: z.string().max(10000).optional() }), async ({ id, bot, notes, template }) => {
  const data = await loadDocuments(id);
  const a = data.application;
  if (a.awaitingReview) throw new ActionError("Review this application before handing it to a bot.");
  const state = parseDriveSync(a.driveSync);
  const account = await loadGoogleAccount();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = env.HIREME_PUBLIC_URL || `${protocol}://${host}`;
  return { prompt: driveApplyPrompt({ applicationId: id, applicationUrl: `${origin}/applications/${encodeURIComponent(id)}`,
    snapshotUrl: !state.error && account?.email === state.account && state.sourceHash === driveSourceHash(data) ? state.url : undefined,
    promptTemplate: template ?? data.settings.applyBotPromptTemplate,
    packetFolderName: applicationPacketName(a.company, a.role || a.title, a.createdAt),
    company: a.company, jobTitle: a.role || a.title, postingUrl: a.postingUrl, postingText: a.postingText,
    jobLocation: a.location, postingSalary: a.salary, applicationStatus: a.status,
    candidate: applyCandidateContext(data.profile.basics), botName: APPLY_BOTS.find(entry => entry.value === bot)!.label,
    botInstructions: notes ?? applicationBotNotes(data.settings)[bot],
  }) };
});
