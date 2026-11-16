import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@/lib/activity";
import { DRIVE_SNAPSHOT_NOTE, applyCandidateContext, driveApplyPrompt, latestDriveSnapshot } from "./drive-handoff";

const note = (url: string): Extract<ActivityEntry, { kind: "note" }> => ({ kind: "note", id: url, body: DRIVE_SNAPSHOT_NOTE + url, date: "today", edited: false });

describe("Drive bot handoff", () => {
  it("restores the latest saved packet from this application's history", () => {
    expect(latestDriveSnapshot([
      { kind: "status", id: "event", status: "DRAFT", date: "today" },
      note("https://drive.google.com/drive/folders/new-snapshot"),
      note("https://drive.google.com/drive/folders/old-snapshot"),
    ])).toBe("https://drive.google.com/drive/folders/new-snapshot");
  });

  it("does not treat arbitrary notes or external links as a Drive packet", () => {
    expect(latestDriveSnapshot([
      { ...note("https://drive.google.com/drive/folders/private"), body: "A recruiter sent a link: https://drive.google.com/drive/folders/private" },
      note("https://drive.google.com.evil.example/drive/folders/fake"),
      note("javascript:alert(1)"),
    ])).toBeNull();
  });

  it("pins the bot to one job snapshot and preserves private access and submit approval", () => {
    const prompt = driveApplyPrompt({ applicationId: "job-one", company: "Acme", jobTitle: "Android engineer", snapshotUrl: "https://drive.google.com/drive/folders/acc-packet", postingUrl: "https://jobs.example/acc" });
    expect(prompt).toContain("Android engineer at Acme");
    expect(prompt).toContain("Application ID: job-one");
    expect(prompt).toContain("https://drive.google.com/drive/folders/acc-packet");
    expect(prompt).toContain("Open this exact Google Drive snapshot");
    expect(prompt).toContain("Do not change sharing permissions or make files public");
    expect(prompt).toContain("never submit without my explicit OK");
    expect(prompt).toContain("resume.pdf");
  });
  it("includes current job context, candidate contacts and every relevant link without treating posting salary as expectations", () => {
    const prompt = driveApplyPrompt({
      applicationId: "job-two", company: "Example", jobTitle: "Mobile engineer",
      applicationUrl: "https://hireme.example/applications/job-two", snapshotUrl: "https://drive.google.com/drive/folders/packet-two",
      postingUrl: "https://jobs.example/mobile", jobLocation: "Romania / hybrid", postingSalary: "EUR 60,000/year", applicationStatus: "SENT",
      candidate: { name: "Jane Doe", email: "jane@example.com", phone: "+351 900 000 000", location: "Lisbon, Portugal", headline: "Android engineer", website: "https://jane.example", linkedin: "https://linkedin.com/in/jane" },
      postingText: "Android IoT firmware validation required.",
    });
    for (const value of ["Jane Doe", "jane@example.com", "+351 900 000 000", "Lisbon, Portugal", "https://jane.example", "https://linkedin.com/in/jane", "https://hireme.example/applications/job-two", "https://jobs.example/mobile", "Romania / hybrid", "Android IoT firmware validation required."]) expect(prompt).toContain(value);
    expect(prompt).toContain("do not treat this as my expected salary");
    expect(prompt).toContain("Current HireMe status: SENT");
    expect(prompt).toContain("do not create a duplicate");
    expect(prompt).toContain("do not silently combine versions");
    expect(prompt).toContain("every form field and its proposed answer");
    expect(prompt).toContain("receipt or other evidence of success");
  });

  it("omits missing personal fields and keeps long posting excerpts behind the review rules", () => {
    const prompt = driveApplyPrompt({ applicationId: "app", snapshotUrl: "https://drive.google.com/drive/folders/packet", postingText: "x".repeat(9000) });
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("- Email:");
    expect(prompt).toContain("Ask for any required information that is absent");
    expect(prompt).toContain("[Excerpt ends here");
    expect(prompt).not.toContain("x".repeat(8001));
    expect(prompt.indexOf("never submit without my explicit OK")).toBeLessThan(prompt.indexOf("<job_posting_reference>"));
  });

  it("tries Drive first, falls back to this job's signed-in ZIP, and requires a verified board update", () => {
    const prompt = driveApplyPrompt({ applicationId: "job-one", applicationUrl: "https://hireme.example/applications/job-one", snapshotUrl: "https://drive.google.com/drive/folders/packet" });
    expect(prompt).toContain("https://hireme.example/api/apply-packets/job-one");
    expect(prompt).toContain("hireme-apply-job-one.zip");
    expect(prompt).toContain("job-one/application.md");
    expect(prompt.indexOf("First choice:")).toBeLessThan(prompt.indexOf("Fallback:"));
    expect(prompt).toContain("Switch to ZIP without waiting for a Drive permission change");
    expect(prompt).toContain("Do not silently mix versions");
    expect(prompt).toContain("update the existing HireMe application job-one");
    expect(prompt).toContain("set its status to SENT");
    expect(prompt).toContain("Verify the saved status and note by reading the card again");
    expect(prompt).toContain("HireMe update is still pending");
    expect(prompt).toContain("Do not mark it SENT without confirmed success");
  });

  it("provides the ZIP workflow when no Drive snapshot exists", () => {
    const prompt = driveApplyPrompt({ applicationId: "job-two", applicationUrl: "https://hireme.example/applications/job-two" });
    expect(prompt).toContain("Not saved to Drive yet; use the ZIP download below");
    expect(prompt).toContain("https://hireme.example/api/apply-packets/job-two");
    expect(prompt).toContain("never submit without my explicit OK");
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("job-one");
  });

  it("copies only application contact fields from the profile", () => {
    const basics = { name: "Jane", email: "jane@example.com", phone: "", city: "Lisbon", country: "Portugal", headline: "Mobile engineer", summary: "Ships mobile apps", website: "", linkedin: "", dob: "1990-01-01", address: "Private street" };
    const candidate = applyCandidateContext(basics);
    expect(candidate.location).toBe("Lisbon, Portugal");
    expect(candidate).not.toHaveProperty("dob");
    expect(candidate).not.toHaveProperty("address");
  });

});

describe("shared prompt templates", () => {
  it("fills the saved format with one job's real facts and includes file and review instructions", () => {
    const result = driveApplyPrompt({ applicationId: "one", company: "Acme", jobTitle: "Android Engineer", postingText: "Android fleet management", applicationUrl: "https://hireme.example/applications/one", snapshotUrl: "https://drive.google.com/drive/folders/one", packetFolderName: "Acme-Android-Engineer-2026-11-14", promptTemplate: "Prepare {{role}} at {{company}}. Requirements: {{job_details}}. Packet: {{drive_url}}" });
    expect(result).toMatch(/^Prepare Android Engineer at Acme/);
    expect(result).toContain("Requirements: Android fleet management");
    expect(result).toContain("https://drive.google.com/drive/folders/one");
    expect(result).toContain("https://hireme.example/api/apply-packets/one");
    expect(result).toContain("Acme-Android-Engineer-2026-11-14.zip");
    expect(result).toContain("Acme-Android-Engineer-2026-11-14/application.md");
    expect(result).toContain("never submit without my explicit OK");
    expect(result).toContain("Update this exact job on the HireMe board");
  });
  it("uses the generated prompt for an empty template and inserts default_prompt only once", () => {
    const input = { applicationId: "one", company: "Example", jobTitle: "Engineer" };
    const generated = driveApplyPrompt(input);
    expect(driveApplyPrompt({ ...input, promptTemplate: "  " })).toBe(generated);
    expect(driveApplyPrompt({ ...input, promptTemplate: "Before\n{{default_prompt}}\nAfter" })).toBe(`Before\n${generated}\nAfter`);
  });
  it("does not interpret placeholders embedded in a posting as additional instructions", () => {
    const result = driveApplyPrompt({ applicationId: "one", company: "Example", postingText: "Literal {{company}} {{default_prompt}}", promptTemplate: "Facts: {{job_details}}" });
    expect(result).toMatch(/^Facts: Literal \{\{company\}\} \{\{default_prompt\}\}/);
    expect(result.match(/## 1\. Application and links/g)).toHaveLength(1);
  });
});
