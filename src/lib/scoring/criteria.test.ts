import { describe, expect, it } from "vitest";

import { cappedScore, criteriaChanged, criteriaLines, criteriaTag } from "./criteria";

describe("scoring criteria", () => {
  it("caps the score only for a missed must-have", () => {
    expect(cappedScore(90, [{ importance: "MUST", met: "no" }])).toBe(49);
    expect(cappedScore(30, [{ importance: "MUST", met: "no" }])).toBe(30);
    expect(cappedScore(90, [{ importance: "MUST", met: "unknown" }, { importance: "IMPORTANT", met: "no" }])).toBe(90);
  });

  it("names met criteria as reasons and missed ones as red flags", () => {
    expect(
      criteriaLines([
        { label: "Salary", importance: "MUST", met: "no" },
        { label: "Remote", importance: "NICE", met: "yes" },
        { label: "Size", importance: "IMPORTANT", met: "unknown" },
      ]),
    ).toEqual({ reasons: ["Meets: Remote"], redFlags: ["Doesn't meet: Salary (must have)"] });
  });

  it("tags a score with the criteria it was scored with", () => {
    const one = [{ id: "a", label: "Salary", preference: "80k", importance: "MUST" as const }];
    expect(criteriaTag([])).toBe("");
    expect(criteriaTag(one)).toMatch(/^ \+criteria:[0-9a-f]{8}$/);
    expect(criteriaTag(one)).toBe(criteriaTag([{ ...one[0], id: "b" }]));
    expect(criteriaTag(one)).not.toBe(criteriaTag([{ ...one[0], importance: "NICE" }]));
  });

  it("says when a score was made with other criteria than today's", () => {
    const one = [{ id: "a", label: "Salary", preference: "80k", importance: "MUST" as const }];
    expect(criteriaChanged("score-posting@3", [])).toBe(false);
    expect(criteriaChanged("score-posting@3", one)).toBe(true);
    expect(criteriaChanged(`score-posting@3${criteriaTag(one)}`, one)).toBe(false);
    expect(criteriaChanged(`score-posting@3${criteriaTag(one)}`, [])).toBe(true);
    expect(criteriaChanged(`score-posting-jev@1 (jev-1.14.0)${criteriaTag(one)}`, [{ ...one[0], preference: "90k" }])).toBe(true);
  });
});
