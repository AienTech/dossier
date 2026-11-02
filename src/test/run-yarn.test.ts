import { describe, expect, it } from "vitest";

import { parseYarnShim, runYarn } from "./run-yarn";

describe("parseYarnShim", () => {
  it("reads node and corepack.js out of Yarn's POSIX shim", () => {
    const source = [
      "#!/bin/sh",
      'exec "C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js" yarn "$@"',
      "",
    ].join("\n");
    expect(parseYarnShim(source)).toEqual({
      node: "C:\\Program Files\\nodejs\\node.exe",
      script: "C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js",
    });
  });

  it("ignores a file that is not that shim", () => {
    expect(parseYarnShim("#!/usr/bin/env node\nconsole.log('yarn')\n")).toBeUndefined();
  });
});

describe("runYarn", () => {
  it("starts Yarn without a yarn binary on PATH", () => {
    expect(() => runYarn(["--version"])).not.toThrow();
  });
});
