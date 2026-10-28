import { describe, expect, it } from "vitest";

import { blockedBy, compileBlocklist, isBlockedPosting } from "./blocklist";

describe("compileBlocklist", () => {
  it("normalizes each name once, and drops one that normalizes to nothing", () => {
    const blocked = compileBlocklist(["Best Buy", "  ", "ProArch IT Solutions Pvt. Ltd."]);
    expect(blocked).toEqual([
      { name: "Best Buy", normalized: "best buy" },
      { name: "ProArch IT Solutions Pvt. Ltd.", normalized: "proarch it solutions pvt ltd" },
    ]);
  });
});

describe("isBlockedPosting", () => {
  it("is false with nothing blocked", () => {
    expect(isBlockedPosting({ company: "Best Buy", title: "Data Engineer" }, [])).toBe(false);
  });

  it("matches the company field, case- and punctuation-insensitively", () => {
    const blocked = compileBlocklist(["Best Buy"]);
    expect(isBlockedPosting({ company: "Best Buy Co., Inc.", title: "Data Engineer" }, blocked)).toBe(true);
    expect(isBlockedPosting({ company: "best buy", title: "Data Engineer" }, blocked)).toBe(true);
    expect(isBlockedPosting({ company: "Target", title: "Data Engineer" }, blocked)).toBe(false);
  });

  it("matches a substring company name ('ProArch' blocks 'ProArch IT Solutions Pvt Ltd')", () => {
    const blocked = compileBlocklist(["ProArch"]);
    expect(isBlockedPosting({ company: "ProArch IT Solutions Pvt Ltd", title: "Sr. Data Engineer" }, blocked)).toBe(true);
  });

  it("catches a staffing listing that only names the company in the title or description", () => {
    const blocked = compileBlocklist(["Best Buy"]);
    expect(isBlockedPosting({ company: "Acme Staffing", title: "Data Engineer (role placed at Best Buy)" }, blocked)).toBe(true);
    expect(isBlockedPosting({ company: "Acme Staffing", title: "Data Engineer", description: "Our client Best Buy is hiring." }, blocked)).toBe(true);
  });

  it("only matches a whole word, not part of a longer one", () => {
    const blocked = compileBlocklist(["Best"]);
    expect(isBlockedPosting({ company: "Bestbuy Inc", title: "Data Engineer" }, blocked)).toBe(false);
    expect(isBlockedPosting({ company: "Best Logistics", title: "Data Engineer" }, blocked)).toBe(true);
  });
});

describe("blockedBy", () => {
  it("names which blocked entry matched, or null", () => {
    const blocked = compileBlocklist(["Best Buy", "ProArch"]);
    expect(blockedBy({ company: "ProArch IT Solutions", title: "" }, blocked)).toBe("ProArch");
    expect(blockedBy({ company: "Acme Corp", title: "" }, blocked)).toBeNull();
    expect(blockedBy({ company: "Acme Corp", title: "" }, [])).toBeNull();
  });
});
