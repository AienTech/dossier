import { describe, expect, it } from "vitest";

import { demoLetterUnits, demoProfile } from "@/lib/demo-profile";

import { englishFrame, isFrameUnit, isParagraph, letterDate, newFrame, withFrame, withoutPrivateParts } from "./letter-frame";

const { basics } = demoProfile();
const context = { basics, company: "Ledgerly", location: "Amsterdam", date: new Date(Date.UTC(2026, 9, 3)), dateFormat: "DAY_MONTH_YEAR" as const };

describe("the letter's frame (E8-11)", () => {
  it("draws the frame as letters always had it, in English", () => {
    expect(englishFrame(context)).toEqual({
      sender: expect.stringMatching(/^Lena Hartmann\n.*lena@hartmann\.studio.* · /),
      date: "3 October 2026",
      recipient: "Ledgerly · Hiring team\nAmsterdam",
      greeting: "Dear Ledgerly team,",
      signature: "Lena Hartmann",
    });
    expect(englishFrame({ ...context, basics: { ...basics, name: " ", email: "", phone: "", website: "", linkedin: "", city: "", country: "", address: "" }, company: "", location: "" })).toEqual({
      sender: "Your name",
      date: "3 October 2026",
      recipient: "Hiring team",
      greeting: "Dear hiring team,",
      signature: "Your name",
    });
  });

  it("writes the date in the letter's language", () => {
    expect(letterDate(context.date, "DAY_MONTH_YEAR", "de")).toBe("3. Oktober 2026");
    expect(letterDate(context.date, "MONTH_DAY_YEAR", "fr")).toBe("3 octobre 2026");
    expect(letterDate(context.date, "MONTH_DAY_YEAR", "en")).toBe("October 3, 2026");
    expect(letterDate(context.date, "NUMERIC", "de")).toBe("03-10-2026");
    expect(letterDate(context.date, "DAY_MONTH_YEAR", undefined)).toBe("3 October 2026");
    expect(letterDate(context.date, "DAY_MONTH_YEAR", "not a tag!")).toBe("3 October 2026");
  });

  it("frames a new letter with the profile's sender and the date in its language", () => {
    expect(newFrame({ ...context, lang: "nl" })).toMatchObject({ date: "3 oktober 2026", signature: "Lena Hartmann", greeting: "Dear Ledgerly team," });
  });

  it("puts every part in reading order, keeping the ones a letter has", () => {
    const units = [{ id: "greeting", label: "Greeting", text: "Hallo," }, ...demoLetterUnits()];
    const framed = withFrame(units, englishFrame(context));
    expect(framed.map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "paragraph:1", "paragraph:2", "paragraph:3", "paragraph:4", "signature"]);
    expect(framed.find((unit) => unit.id === "greeting")?.text).toBe("Hallo,");
    expect(framed.find((unit) => unit.id === "date")).toEqual({ id: "date", label: "Date", text: "3 October 2026" });
    // The sign-off comes after the paragraphs, then the signature.
    expect(withFrame([{ id: "sign-off", label: "Sign-off", text: "Groetjes," }, ...demoLetterUnits()], { signature: "Lena" }).slice(-2).map((unit) => unit.id)).toEqual(["sign-off", "signature"]);
    // Only what's given is added.
    expect(withFrame(demoLetterUnits(), { date: "heute" }).map((unit) => unit.id)).toEqual(["date", "paragraph:1", "paragraph:2", "paragraph:3", "paragraph:4"]);
  });

  it("tells the parts apart, and keeps contact details out of prompts", () => {
    const framed = withFrame(demoLetterUnits(), englishFrame(context));
    expect(framed.filter((unit) => isFrameUnit(unit.id)).map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "signature"]);
    expect(framed.filter(isParagraph)).toHaveLength(4);
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).not.toContain("sender");
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).not.toContain("signature");
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).toContain("greeting");
  });
});
