import { describe, expect, it } from "vitest";
import { botLaunchMessage, botLaunchUrl } from "./bot-launch";
const job = { applicationId: "job-one", applicationUrl: "https://hireme.example/applications/job-one", company: "Acme", jobTitle: "Android Engineer", botName: "Grok Bot" };

describe("bot launch handoff", () => {
  it("prefills the selected Grok bot with Drive first, exact ZIP fallback and tracking URLs", () => {
    const message = botLaunchMessage({ ...job, snapshotUrl: "https://drive.google.com/drive/folders/current" });
    expect(message.length).toBeLessThanOrEqual(1000);
    expect(message).toContain("Android Engineer at Acme");
    expect(message).toContain("Drive first: https://drive.google.com/drive/folders/current");
    expect(message).toContain("ZIP fallback: https://hireme.example/api/apply-packets/job-one");
    expect(message).toContain("bot-prompt.md");
    expect(message).toContain("never submit without my explicit approval");
    expect(message).toContain("update this existing HireMe card");
    const link = new URL(botLaunchUrl("grok", message, "bot-123")!);
    expect(link.searchParams.get("id")).toBe("bot-123");
    expect(link.searchParams.get("text")).toBe(message.replace(/\s+/g, " "));
  });
  it("uses Grok's primary bot without an ID, Claude's desktop composer, and clipboard for unknown apps", () => {
    const message = botLaunchMessage(job);
    expect(message).not.toContain("Drive first:");
    expect(message).toContain("ZIP packet:");
    expect(new URL(botLaunchUrl("grok", message, null)!).searchParams.has("id")).toBe(false);
    const claude = new URL(botLaunchUrl("claude", message, null)!);
    expect(claude.protocol).toBe("claude:"); expect(claude.searchParams.get("q")).toBe(message);
    expect(botLaunchUrl("openbot", message, null)).toBeNull();
    expect(botLaunchUrl("copy", message, null)).toBeNull();
  });
  it("does not truncate links or approval instructions to fit very long job titles or URLs", () => {
    const message = botLaunchMessage({ ...job, company: "x".repeat(500), jobTitle: "y".repeat(1000), snapshotUrl: `https://drive.google.com/${"a".repeat(900)}` });
    expect(message.length).toBeLessThanOrEqual(1000);
    expect(message).toContain(job.applicationUrl);
    expect(message).toContain("explicit approval");
    const huge = botLaunchMessage({ ...job, applicationUrl: `https://hireme.example/${"a".repeat(1500)}` });
    expect(huge.length).toBeLessThanOrEqual(1000);
    expect(huge).toContain("clipboard");
  });
});

describe("OpenBot local helper", () => {
  it("uses an opt-in review helper and safely encodes the prompt as data", () => {
    const message = "Drive: https://drive.google.com/drive/folders/test\nZIP: https://hireme.example/packet?x=1&y=2";
    expect(botLaunchUrl("openbot", message, null)).toBeNull();
    const link = new URL(botLaunchUrl("openbot", message, null, "mac-helper")!);
    expect(link.protocol).toBe("hireme-bot:"); expect(link.host).toBe("openbot"); expect(link.pathname).toBe("/apply");
    expect(link.searchParams.get("message")).toBe(message);
    expect(link.searchParams.get("agent")).toBe("Job Manager");
    expect([...link.searchParams.keys()]).toEqual(["agent", "message"]);
  });
});


describe("Grok Bot local helper", () => {
  it("opens the configured agent through the helper without Grok's short-link limits", () => {
    const message = "Full prompt\nDrive: https://drive.google.com/drive/folders/test?a=1&b=2";
    const link = new URL(botLaunchUrl("grok", message, "bot-id", "clipboard", "Job Manager", "mac-helper", "Job Finder")!);
    expect(link.protocol).toBe("hireme-bot:");
    expect(link.host).toBe("grok");
    expect(link.searchParams.get("agent")).toBe("Job Finder");
    expect(link.searchParams.get("message")).toBe(message);
  });
});
