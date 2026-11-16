import { describe, expect, it } from "vitest";

import { passwordProblem } from "./password-policy";

describe("password setup", () => {
  it("accepts long passphrases and generated passwords", () => {
    expect(passwordProblem("four quiet rivers under moonlight")).toBeNull();
    expect(passwordProblem("Yb9-jN2q-Wc7s-Pm4a-Hr6d")).toBeNull();
  });

  it("rejects short, oversized and repeated passwords without echoing them", () => {
    for (const password of ["hunter2", "passwordpassword", "a".repeat(20), " ".repeat(20), "x".repeat(257)]) {
      const problem = passwordProblem(password);
      expect(problem).toBeTruthy();
      expect(problem).not.toContain(password);
    }
  });
});
