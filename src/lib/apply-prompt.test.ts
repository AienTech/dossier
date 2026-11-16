import { describe, expect, it } from "vitest";

import {
  buildApplyBotPrompt,
  buildApplyBotPromptCompact,
  expectedSalaryLine,
  experienceLine,
  locationLine,
} from "./apply-prompt";

describe("apply prompt helpers", () => {
  it("builds location and experience lines", () => {
    expect(locationLine("Islamabad", "Pakistan")).toBe("Islamabad, Pakistan");
    expect(locationLine("", "Pakistan")).toBe("Pakistan");
    expect(experienceLine("Android engineer", "Eight years building apps.").startsWith("Android engineer")).toBe(true);
    expect(expectedSalaryLine("")).toContain("3,500+");
    expect(expectedSalaryLine(" €70k ")).toBe("€70k");
  });

  it("builds a full apply prompt with standard answers and rules", () => {
    const prompt = buildApplyBotPrompt({
      jobTitle: "Senior Software Engineer, Frontend",
      company: "Affirm",
      postingUrl: "https://job-boards.greenhouse.io/affirm/jobs/1",
      packetDir: "/Users/me/Documents/HireMe/apply/app-1",
      answers: {
        location: "Islamabad, Pakistan",
        expectedSalary: "3,500+ USD/month",
        experience: "8+ years Android/mobile; BS Computer Science.",
      },
    });
    expect(prompt).toContain("Apply to Senior Software Engineer, Frontend at Affirm for me:");
    expect(prompt).toContain("Materials: /Users/me/Documents/HireMe/apply/app-1");
    expect(prompt).toContain("application.md");
    expect(prompt).toContain("My standard answers");
    expect(prompt).toContain("Islamabad, Pakistan");
    expect(prompt).toContain("Remote only");
    expect(prompt).toContain("never submit without my OK");
    expect(prompt).toContain("excludes Pakistan");
    expect(prompt).toContain("mark it Sent in HireMe");
    expect(prompt.includes("\n")).toBe(true);
  });

  it("uses MCP write-back wording for Claude", () => {
    const prompt = buildApplyBotPrompt({
      jobTitle: "Engineer",
      company: "Acme",
      postingUrl: "https://jobs.example/1",
      applicationId: "app-1",
      answers: { location: "Berlin, Germany", expectedSalary: "€70k", experience: "Frontend" },
    });
    expect(prompt).toContain("get_application");
    expect(prompt).toContain("set_application_status to SENT");
    expect(prompt).toContain("add_application_note");
  });

  it("compacts under a length budget", () => {
    const compact = buildApplyBotPromptCompact(
      {
        jobTitle: "Engineer",
        company: "Acme",
        postingUrl: `https://jobs.example/${"x".repeat(800)}`,
        packetDir: "/Users/me/Documents/HireMe/apply/app-1",
        answers: { location: "Islamabad, Pakistan", expectedSalary: "3500 USD", experience: "Mobile" },
      },
      1000,
    );
    expect(compact.length).toBeLessThanOrEqual(1000);
    expect(compact).toContain("never submit without my OK");
  });
});
