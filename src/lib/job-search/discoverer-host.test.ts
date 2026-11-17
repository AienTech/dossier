import { describe, expect, it } from "vitest";

import { isDiscovererHost, isLocalDiscovererHost } from "./discoverer-host";

describe("isLocalDiscovererHost", () => {
  it("accepts loopback-style hosts only", () => {
    expect(isLocalDiscovererHost("127.0.0.1")).toBe(true);
    expect(isLocalDiscovererHost("127.0.0.1:8787")).toBe(true);
    expect(isLocalDiscovererHost("localhost")).toBe(true);
    expect(isLocalDiscovererHost("localhost:8787")).toBe(true);
    expect(isLocalDiscovererHost("[::1]")).toBe(true);
    expect(isLocalDiscovererHost("host.docker.internal")).toBe(true);
    expect(isLocalDiscovererHost("host.docker.internal:8787")).toBe(true);
    expect(isLocalDiscovererHost("jobspy.example.com")).toBe(false);
    expect(isLocalDiscovererHost("freehire.me")).toBe(false);
  });
});

describe("isDiscovererHost", () => {
  it("also accepts a tunnel host when the discoverer flag is on", () => {
    expect(isDiscovererHost("jobspy.example.com", false)).toBe(false);
    expect(isDiscovererHost("jobspy.example.com", true)).toBe(true);
    expect(isDiscovererHost("127.0.0.1", false)).toBe(true);
  });
});
