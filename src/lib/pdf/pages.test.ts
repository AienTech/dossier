import { describe, expect, it } from "vitest";

import { printBasePath, printThemePath } from "./pages";

describe("profile-specific print paths", () => {
  it("keeps base resume compression and profile in the signed path", () => {
    expect(printBasePath()).toBe("/print/base");
    expect(printBasePath(2, "second-profile")).toBe("/print/base?profile=second-profile&fit=2");
  });

  it("keeps the same profile on every comparison sample", () => {
    expect(printThemePath("studio")).toBe("/print/theme/studio");
    expect(printThemePath("studio", undefined, "second-profile")).toBe("/print/theme/studio?profile=second-profile");
    expect(printThemePath("signal", "letter", "second-profile")).toBe("/print/theme/signal/letter?profile=second-profile");
    expect(printThemePath("studio", "references", "second-profile")).toBe("/print/theme/studio/references?profile=second-profile");
  });

  it("encodes path and query values rather than interpreting them as URL syntax", () => {
    expect(printThemePath("theme/name", "letter", "profile & name")).toBe("/print/theme/theme%2Fname/letter?profile=profile+%26+name");
  });
});
