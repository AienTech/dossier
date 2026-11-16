/**
 * Shared “Apply with bot” instructions: a complete handoff prompt for Grok /
 * Claude, and the same rules written into the local apply packet.
 */

export type ApplyPromptAnswers = {
  /** e.g. "Islamabad, Pakistan" */
  location: string;
  /** e.g. "3,500+ USD/month" or the application's target figure */
  expectedSalary: string;
  /** Short skills / seniority line from the profile */
  experience: string;
};

export type ApplyPromptInput = {
  jobTitle: string;
  company: string;
  postingUrl: string;
  /** Separate apply URL when it differs from the posting page. */
  applyUrl?: string;
  /** Absolute path to the local packet folder (Grok). */
  packetDir?: string;
  answers: ApplyPromptAnswers;
  /**
   * Claude MCP closed loop: application id so the bot can call connector tools.
   * Omit for Grok.
   */
  applicationId?: string;
  /** Whether tailored PDFs exist when there is no packet folder yet. */
  hasDocuments?: boolean;
};

const DEFAULT_SALARY = "3,500+ USD/month (for Pakistan-based roles: 800,000+ PKR/month)";

/** Fill salary from the application when set; otherwise the default band. */
export function expectedSalaryLine(applicationSalary: string | null | undefined): string {
  const salary = (applicationSalary ?? "").trim();
  return salary || DEFAULT_SALARY;
}

/** "City, Country" from profile basics; empty parts dropped. */
export function locationLine(city: string | null | undefined, country: string | null | undefined): string {
  return [city, country]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** One-line experience from headline + summary (capped for prompts). */
export function experienceLine(headline: string | null | undefined, summary: string | null | undefined, max = 220): string {
  const head = (headline ?? "").trim();
  const body = (summary ?? "").trim().replace(/\s+/g, " ");
  const combined = [head, body].filter(Boolean).join(" — ");
  if (!combined) return "See my resume in the materials; do not invent experience.";
  return combined.length <= max ? combined : `${combined.slice(0, max - 1)}…`;
}

function materialsBlock(input: ApplyPromptInput): string {
  const dir = input.packetDir?.trim();
  if (dir) {
    return (
      `Materials: ${dir}\n` +
      `(read application.md and instructions.md; attach resume.pdf and cover-letter.pdf when the form asks. ` +
      `Use only these files — do not invent experience.)`
    );
  }
  if (input.applicationId) {
    return (
      `Materials: load application id "${input.applicationId}" with get_application ` +
      `(posting URL, tailored resume, cover letter). Use only that — do not invent experience.`
    );
  }
  if (input.hasDocuments) {
    return "Materials: I will attach my tailored resume and cover letter PDFs — wait for those files; use only them; do not invent experience.";
  }
  return "Materials: ask me to attach my resume and cover letter; do not invent experience.";
}

function hiremeClose(input: ApplyPromptInput): string {
  if (input.applicationId) {
    return (
      "After I confirm the submit, call set_application_status to SENT. " +
      "For later updates (recruiter reply, interview, rejection), add_application_note and set_application_status as needed."
    );
  }
  return "After I confirm the submit, remind me to mark it Sent in HireMe.";
}

/**
 * Full multi-line apply instructions for clipboard / Claude chat.
 * Based on the user’s apply handoff template.
 */
export function buildApplyBotPrompt(input: ApplyPromptInput): string {
  const title = input.jobTitle.trim() || "this role";
  const company = input.company.trim() || "this company";
  const posting = input.postingUrl.trim();
  const apply = (input.applyUrl ?? "").trim();
  const location = input.answers.location.trim() || "my profile location (see materials)";
  const countryHint = location.includes(",") ? location.split(",").at(-1)!.trim() : location;

  const lines = [
    `Apply to ${title} at ${company} for me: ${posting}`,
    apply && apply !== posting ? `Direct apply link: ${apply}` : null,
    "",
    materialsBlock(input),
    "",
    "My standard answers (use them — no need to ask unless a field is missing):",
    `- Location: ${location}. Remote only; I can work US/EU hours.`,
    `- Availability: immediately, no notice period.`,
    `- Salary: ${input.answers.expectedSalary.trim() || DEFAULT_SALARY}.`,
    `- Experience: ${input.answers.experience.trim() || "See my resume in the materials; do not invent experience."}`,
    `- Contractor or B2B: OK. Visa sponsorship: not needed for remote.`,
    "",
    "Rules:",
    "- Open the apply page in your browser and fill it in.",
    "- Show me every answer before submitting; never submit without my OK.",
    "- Pause for login, CAPTCHA, or 2FA.",
    `- Tell me up front if the job excludes ${countryHint || "my country"} or remote work from there.`,
    `- ${hiremeClose(input)}`,
  ];

  return lines.filter((line) => line !== null).join("\n");
}

/** Compact one-line prompt when a URL length budget is tight (e.g. grokbot deep link). */
export function buildApplyBotPromptCompact(input: ApplyPromptInput, maxLength: number): string {
  const full = buildApplyBotPrompt(input).replace(/\s+/g, " ").trim();
  if (full.length <= maxLength) return full;
  const title = input.jobTitle.trim() || "role";
  const company = input.company.trim() || "company";
  const posting = input.postingUrl.trim();
  const dir = input.packetDir?.trim();
  const close = input.applicationId
    ? " After submit OK, set_application_status SENT."
    : " After submit OK, remind me to mark Sent in HireMe.";
  const rules = " Show every answer before submit; never submit without my OK. Pause for login/CAPTCHA/2FA.";
  const materials = dir
    ? ` Materials: ${dir} (read application.md + instructions.md; attach PDFs; do not invent).`
    : input.applicationId
      ? ` Use get_application "${input.applicationId}"; do not invent.`
      : " Use only my attached resume/letter; do not invent.";
  const lead = `Apply to ${title} at ${company}: ${posting}.`;
  const assembled = `${lead}${materials}${rules}${close}`.replace(/\s+/g, " ").trim();
  if (assembled.length <= maxLength) return assembled;
  const budget = maxLength - rules.length - 1;
  const clipped = assembled.slice(0, Math.max(0, budget - rules.length));
  return `${clipped.trim()}…${rules}`.slice(0, maxLength);
}

/** Full instructions.md body for the local apply packet. */
export function buildApplyPacketInstructions(input: {
  dir: string;
  jobTitle: string;
  company: string;
  postingUrl: string;
  applyUrl?: string;
  answers: ApplyPromptAnswers;
  applicationId?: string;
  applicationUrl?: string;
  zipUrl?: string;
  driveUrl?: string;
}): string {
  return (
    buildApplyBotPrompt({
      jobTitle: input.jobTitle,
      company: input.company,
      postingUrl: input.postingUrl,
      applyUrl: input.applyUrl,
      packetDir: input.dir,
      answers: input.answers,
    }) +
    "\n\n---\n\n" +
    "## Packet links\n\n" +
    (input.applicationId ? `- Application ID: ${input.applicationId}\n` : "") +
    (input.applicationUrl ? `- HireMe card: ${input.applicationUrl}\n` : "") +
    (input.driveUrl ? `- Google Drive folder: ${input.driveUrl}\n` : "") +
    (input.zipUrl ? `- ZIP download of this folder: ${input.zipUrl}\n` : "") +
    "\n" +
    "## Files in this folder\n\n" +
    "- `application.md` — posting, match, resume/letter text\n" +
    "- `resume.pdf` / `cover-letter.pdf` — attach when the form asks\n" +
    "- This file — follow it as the source of truth for answers and rules\n"
  );
}
