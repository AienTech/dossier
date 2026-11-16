import { describe, expect, it } from "vitest";

import { claudeApplyPrompt, claudeApplyUrl, grokApplyHandoff, isApplyBot } from "./apply-bot";

describe("apply-bot", () => {
  it("recognises apply bot ids", () => {
    expect(isApplyBot("claude")).toBe(true);
    expect(isApplyBot("grok")).toBe(true);
    expect(isApplyBot("openbot")).toBe(true);
    expect(isApplyBot("copy")).toBe(true);
    expect(isApplyBot("other")).toBe(false);
  });

  it("builds a Claude apply prompt that names the application and write-back tools", () => {
    const prompt = claudeApplyPrompt({
      applicationId: "app-1",
      company: "Acme",
      role: "Senior Frontend",
      postingUrl: "https://jobs.example/1",
      answers: { location: "Lisbon, Portugal", expectedSalary: "3,500+ USD/month", experience: "Frontend" },
    });
    expect(prompt).toContain('application id "app-1"');
    expect(prompt).toContain("Senior Frontend at Acme");
    expect(prompt).toContain("get_application");
    expect(prompt).toContain("set_application_status");
    expect(prompt).toContain("add_application_note");
    expect(prompt).toContain("never submit without my OK");
    expect(prompt).toContain("My standard answers");
    expect(prompt).toContain("Lisbon, Portugal");
    expect(claudeApplyUrl({ applicationId: "app-1", postingUrl: "https://jobs.example/1" })).toContain("claude.ai/new?q=");
  });

  it("builds a Grok handoff that names the local apply packet folder", () => {
    const { href, prompt } = grokApplyHandoff({
      postingUrl: "https://jobs.example/1",
      company: "Acme",
      role: "Frontend",
      hasDocuments: true,
      packetDir: "/Users/me/Documents/HireMe/apply/app-1",
      answers: { location: "Lisbon, Portugal", experience: "Mobile" },
      grokBotId: null,
    });
    expect(new URL(href).protocol).toBe("grokbot:");
    expect(new URL(href).searchParams.get("text")).toContain("Frontend at Acme");
    expect(prompt).toContain("/Users/me/Documents/HireMe/apply/app-1");
    expect(prompt).toContain("application.md");
    expect(prompt).toContain("My standard answers");
    expect(prompt).not.toContain("where you have them");
  });
});
