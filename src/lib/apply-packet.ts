import "server-only";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { zipSync } from "fflate";

import { DocumentKind } from "@/generated/prisma/enums";
import { applicationPacketName } from "@/lib/application-packet-name";
import { unitsSchema } from "@/lib/application-data";
import {
  buildApplyPacketInstructions,
  expectedSalaryLine,
  experienceLine,
  locationLine,
  type ApplyPromptAnswers,
} from "@/lib/apply-prompt";
import { applyPacketPassword } from "@/lib/apply-packet-access";
import { applyPacketPath, applyPacketUrl } from "@/lib/apply-packet-url";
import { applyCandidateContext, candidateContextLines, packetBotPrompt, type DriveApplyPromptInput, type ApplyCandidateContext } from "@/lib/drive-handoff";
import { applicationBotNotes, type ApplyBotNotes } from "@/lib/application-bots";
import { loadSettings } from "@/lib/settings-data";
import { env } from "@/lib/env";
import { withoutPrivateParts } from "@/lib/letter-frame";
import { renderPdf } from "@/lib/pdf/render";
import { loadProfile } from "@/lib/profile-data";
import { prisma } from "@/lib/prisma";
import { cloudRuntime } from "@/lib/runtime";

/** Parent folder for Grok (and other non-MCP bots) apply packets on this Mac. */
export function applyPacketRoot(): string {
  return path.join(homedir(), "Documents", "HireMe", "apply");
}

/** One application’s packet directory (rewritten on each Apply with bot). */
export function applyPacketDir(folderName: string): string {
  return path.join(applyPacketRoot(), folderName);
}

function documentText(units: unknown): string {
  const parsed = unitsSchema.safeParse(units);
  if (!parsed.success) return "";
  return withoutPrivateParts(parsed.data)
    .map((unit) => `## ${unit.label || unit.id}\n${unit.text}`)
    .join("\n\n");
}

function applicationMarkdown(input: {
  id: string;
  title: string;
  company: string;
  role: string;
  location: string;
  salary: string;
  postingUrl: string;
  postingText: string;
  match: unknown;
  resume: string;
  letter: string;
  files: string[];
  answers: ApplyPromptAnswers;
  candidate: ApplyCandidateContext;
}): string {
  const lines = [
    `# ${input.role || input.title || "Application"} at ${input.company || "Company"}`,
    "",
    `- Application id: \`${input.id}\``,
    `- Role location (posting): ${input.location || "—"}`,
    `- Salary (posting / target): ${input.salary || "—"}`,
    `- Posting: ${input.postingUrl || "—"}`,
    "",
    "## Candidate contact and profile",
    "",
    ...candidateContextLines(input.candidate),
    "",
    "## Standard answers for the form",
    "",
    `- My location: ${input.answers.location || "—"}`,
    `- Expected salary: ${input.answers.expectedSalary}`,
    `- Experience: ${input.answers.experience}`,
    `- Remote only; can work US/EU hours. Available immediately. Contractor/B2B OK. Visa not needed for remote.`,
    "",
    "## Files in this folder",
    ...input.files.map((name) => `- \`${name}\``),
    "",
    "## Posting",
    "",
    input.postingText.trim().slice(0, 20_000) || "(no posting text)",
    "",
  ];
  if (input.match != null) {
    lines.push("## Match", "", "```json", JSON.stringify(input.match, null, 2).slice(0, 8_000), "```", "");
  }
  if (input.resume) lines.push("## Resume (text)", "", input.resume, "");
  if (input.letter) lines.push("## Cover letter (text)", "", input.letter, "");
  return lines.join("\n").trim() + "\n";
}

export type ApplyPacketResult = {
  dir: string;
  /** Cloud packets are downloaded and extracted on the user's computer. */
  downloadUrl?: string;
  archiveName?: string;
  folderName?: string;
  files: string[];
  answers: ApplyPromptAnswers;
};

/**
 * Writes (or replaces) a local folder Grok can read: markdown + PDFs for one
 * application. Safe to call repeatedly; the previous folder for that application is replaced.
 */
export async function writeApplyPacket(applicationId: string): Promise<ApplyPacketResult> {
  return (await buildApplyPacket(applicationId, cloudRuntime() ? "describe" : "local")).packet;
}

/** Build in request memory; cloud downloads never need a storage service. */
export async function buildApplyPacket(applicationId: string, mode: "download" | "local" | "describe" = "download", origin?: string): Promise<{ packet: ApplyPacketResult; zip: Uint8Array; promptContext?: { input: DriveApplyPromptInput; notes: ApplyBotNotes } }> {
  const [application, profile, settings] = await Promise.all([
    prisma.application.findUnique({
      where: { id: applicationId, awaitingReview: false },
      select: {
        id: true,
        title: true,
        createdAt: true,
        company: true,
        role: true,
        location: true,
        salary: true,
        postingUrl: true,
        postingText: true,
        match: true,
        status: true,
        documents: { select: { kind: true, units: true } },
      },
    }),
    loadProfile(),
    loadSettings(),
  ]);
  if (!application) throw new Error("That application no longer exists.");

  const answers: ApplyPromptAnswers = {
    location: locationLine(profile.basics.city, profile.basics.country),
    expectedSalary: expectedSalaryLine(application.salary),
    experience: experienceLine(profile.basics.headline, profile.basics.summary),
  };

  const cloud = mode !== "local";
  const folderName = applicationPacketName(application.company, application.role || application.title, application.createdAt);
  const dir = cloud ? `~/Documents/hireme/apply/${folderName}` : applyPacketDir(folderName);
  const site = env.HIREME_PUBLIC_URL || origin || `http://localhost:${process.env.PORT || "3000"}`;
  const packetPassword = applyPacketPassword();
  const promptContext = { input: {
    applicationId: application.id, applicationUrl: `${site}/applications/${encodeURIComponent(application.id)}`,
    packetFolderName: folderName, company: application.company, jobTitle: application.role || application.title,
    jobLocation: application.location, postingSalary: application.salary, postingUrl: application.postingUrl,
    postingText: application.postingText, applicationStatus: application.status,
    candidate: applyCandidateContext(profile.basics), promptTemplate: settings.applyBotPromptTemplate,
    packetPassword,
  }, notes: applicationBotNotes(settings) };
  if (mode === "describe") {
    return {
      packet: {
        dir,
        folderName,
        downloadUrl: applyPacketPath(application.id, packetPassword),
        archiveName: `${folderName}.zip`,
        files: ["application.md", "instructions.md", "bot-prompt.md",
          ...application.documents.flatMap(document => document.kind === DocumentKind.RESUME ? ["resume.pdf"] : document.kind === DocumentKind.COVER_LETTER ? ["cover-letter.pdf"] : []),
        ],
        answers,
      },
      zip: new Uint8Array(),
    };
  }
  const bundle: Record<string, Uint8Array> = {};
  if (!cloud) {
    const previous = await readFile(path.join(dir, "application.md"), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const exists = await stat(dir).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    if (exists && (previous === null || !previous.includes(`- Application id: \`${application.id}\``))) {
      throw new Error("Another application already uses this local packet folder. Move that folder before extracting this packet.");
    }
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
  const save = async (name: string, data: string | Uint8Array) => {
    if (cloud) bundle[name] = typeof data === "string" ? new TextEncoder().encode(data) : data;
    else await writeFile(path.join(dir, name), data);
  };

  const resumeUnits = application.documents.find((document) => document.kind === DocumentKind.RESUME)?.units;
  const letterUnits = application.documents.find((document) => document.kind === DocumentKind.COVER_LETTER)?.units;
  const resume = documentText(resumeUnits);
  const letter = documentText(letterUnits);

  const files: string[] = ["application.md", "instructions.md", "bot-prompt.md"];

  if (resumeUnits) {
    await save("resume.pdf", await renderPdf(`/print/resume/${application.id}`));
    files.push("resume.pdf");
  }
  if (letterUnits) {
    await save("cover-letter.pdf", await renderPdf(`/print/letter/${application.id}`));
    files.push("cover-letter.pdf");
  }

  await save(
    "application.md",
    applicationMarkdown({
      id: application.id,
      title: application.title,
      company: application.company,
      role: application.role,
      location: application.location,
      salary: application.salary,
      postingUrl: application.postingUrl,
      postingText: application.postingText,
      match: application.match,
      resume,
      letter,
      files,
      answers,
      candidate: applyCandidateContext(profile.basics),
    }),
  );
  await save(
    "instructions.md",
    buildApplyPacketInstructions({
      dir,
      jobTitle: application.role || application.title,
      company: application.company,
      postingUrl: application.postingUrl,
      answers,
      applicationId: application.id,
      applicationUrl: `${site}/applications/${encodeURIComponent(application.id)}`,
      zipUrl: applyPacketUrl(site, application.id, packetPassword),
    }),
  );

  await save("bot-prompt.md", packetBotPrompt(promptContext.input, promptContext.notes));

  if (cloud) {
    return { promptContext, packet: { dir, folderName, archiveName: `${folderName}.zip`, files, answers }, zip: zipSync({ [folderName]: bundle }) };
  }
  return { promptContext, packet: { dir, folderName, files, answers }, zip: new Uint8Array() };
}
