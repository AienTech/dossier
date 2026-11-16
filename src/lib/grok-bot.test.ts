import { describe, expect, it } from "vitest";

import {
  GROK_BOT_PROMPT_MAX,
  grokBotApplyPrompt,
  grokBotApplyPromptForDeepLink,
  grokBotApplyUrl,
  grokBotAppUrl,
  parseGrokBotId,
} from "./grok-bot";

describe("parseGrokBotId", () => {
  it("accepts a bare id", () => {
    expect(parseGrokBotId(" bot_abc-123.XYZ ")).toBe("bot_abc-123.XYZ");
  });

  it("reads id from Copy-link style URLs", () => {
    expect(parseGrokBotId("grokbot://app/v1/prompt?id=bot_abc&text=hi")).toBe("bot_abc");
    expect(parseGrokBotId("https://example.com/bots/bot_from_path")).toBe("bot_from_path");
  });

  it("rejects empty or junk", () => {
    expect(parseGrokBotId("")).toBeNull();
    expect(parseGrokBotId("has spaces")).toBeNull();
    expect(parseGrokBotId("short")).toBeNull();
  });
});

describe("grokBotApplyPrompt", () => {
  it("names the role and company and points at the local packet folder", () => {
    const prompt = grokBotApplyPrompt({
      postingUrl: "https://jobs.example/1",
      company: "Acme",
      role: "Frontend engineer",
      hasDocuments: true,
      packetDir: "/Users/me/Documents/HireMe/apply/app-1",
      answers: {
        location: "Lisbon, Portugal",
        expectedSalary: "3,500+ USD/month",
        experience: "8+ years Android/mobile",
      },
    });
    expect(prompt).toContain("Frontend engineer at Acme");
    expect(prompt).toContain("https://jobs.example/1");
    expect(prompt).toContain("/Users/me/Documents/HireMe/apply/app-1");
    expect(prompt).toContain("application.md");
    expect(prompt).toContain("do not invent experience");
    expect(prompt).toContain("never submit without my OK");
    expect(prompt).toContain("mark it Sent in HireMe");
    expect(prompt).toContain("Lisbon, Portugal");
    expect(prompt).toContain("My standard answers");
    expect(prompt.includes("\n")).toBe(true);
  });

  it("asks for attachments when there is no packet and no documents", () => {
    const prompt = grokBotApplyPrompt({ postingUrl: "https://jobs.example/1", hasDocuments: false });
    expect(prompt).toContain("ask me to attach");
  });

  it("keeps the deep-link prompt under the limit for a long URL", () => {
    const postingUrl = `https://jobs.example/${"a".repeat(900)}`;
    const prompt = grokBotApplyPromptForDeepLink({
      postingUrl,
      company: "Acme",
      role: "Engineer",
      hasDocuments: true,
      packetDir: "/Users/me/Documents/HireMe/apply/app-1",
    });
    expect(prompt.length).toBeLessThanOrEqual(GROK_BOT_PROMPT_MAX);
    expect(prompt).toContain("never submit without my OK");
  });
});

describe("grokBot URLs", () => {
  it("builds an app prompt link when a Bot id is set", () => {
    const text = "Apply for me: https://jobs.example/1";
    const app = new URL(grokBotAppUrl("bot_1", text));
    expect(app.protocol).toBe("grokbot:");
    expect(app.searchParams.get("id")).toBe("bot_1");
    expect(app.searchParams.get("text")).toBe(text);
    expect(grokBotApplyUrl("bot_1", text)).toContain("grokbot://app/v1/prompt");
    const primary = new URL(grokBotApplyUrl(null, text));
    expect(primary.searchParams.has("id")).toBe(false);
    expect(primary.searchParams.get("text")).toBe(text);
  });
});

describe("Grok prompt link text validation", () => {
  it("flattens line breaks and removes invisible/control characters rejected by Grok", () => {
    const url = new URL(grokBotAppUrl(null, "Prepare this job\nDrive: https://drive.google.com/drive/folders/one\r\nZIP: https://hireme.example/packet\tAsk\u200b before submitting.\u0000"));
    const text = url.searchParams.get("text")!;
    expect(text).toBe("Prepare this job Drive: https://drive.google.com/drive/folders/one ZIP: https://hireme.example/packet Ask before submitting.");
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/u);
  });
  it("does not leave a lone surrogate when shortening an emoji-containing message", () => {
    const text = new URL(grokBotAppUrl(null, `${"x".repeat(999)}😀`)).searchParams.get("text")!;
    expect(text).toBe("x".repeat(999));
  });
});
