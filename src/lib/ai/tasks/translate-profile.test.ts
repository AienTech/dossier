import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { MockProvider } from "../providers/mock";

import { TRANSLATE_PROFILE_VERSION, translatableParts, translateProfile } from "./translate-profile";

const profile = demoProfile();
const options = { creativity: "EXPRESSIVE" as const, strict: true, language: null };

describe("translateProfile (#148)", () => {
  it("sends the profile's own text by id, never contact details, references or names that stay as written, and returns the answer", async () => {
    const answer = { ...translatableParts(profile), headline: "Diseñador de producto" };
    const provider = new MockProvider({ reply: () => answer });
    const { data, promptVersion } = await translateProfile(provider, { profile, language: "Spanish" }, options);
    expect(promptVersion).toBe(TRANSLATE_PROFILE_VERSION);
    expect(data.headline).toBe("Diseñador de producto");

    const call = provider.calls[0];
    const text = [call.system, ...call.messages.map((message) => message.content)].join("\n");
    expect(call.json?.name).toBe("translated_profile");
    expect(text).toContain("Translate this into Spanish:");
    expect(text).toContain(`"id": "${profile.experience[0].id}"`);
    expect(text).toContain(profile.experience[0].role);
    for (const kept of [profile.basics.email, profile.basics.phone, profile.experience[0].company, ...profile.references.map((reference) => reference.name)]) expect(text).not.toContain(kept);
    expect(call.maxTokens).toBe(16000);
    expect(call.system).toContain("Keep technical terms in their original language");
  });
});
