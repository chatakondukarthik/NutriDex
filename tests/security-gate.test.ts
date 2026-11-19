import { describe, expect, it } from "vitest";
import {
  hostOf,
  isLoopbackHost,
  tokenMatches,
  resolveGateMode,
  parseAllowedHosts,
  hostMatches,
  decideGate,
} from "@/lib/security/gate";

/**
 * The request gate is the only thing between a LAN caller and 43
 * unauthenticated server actions. Its first version forgot to strip the
 * port from `Host`, so `localhost:3000` looked remote and the app 403'd
 * itself. These cases pin the parsing.
 */

describe("hostOf", () => {
  it("drops the port from an ordinary host", () => {
    expect(hostOf("localhost:3000")).toBe("localhost");
    expect(hostOf("127.0.0.1:8080")).toBe("127.0.0.1");
  });

  it("drops the port from a bracketed IPv6 literal", () => {
    expect(hostOf("[::1]:3000")).toBe("::1");
    expect(hostOf("[::1]")).toBe("::1");
  });

  it("keeps a bare IPv6 literal intact (its colons are not a port)", () => {
    expect(hostOf("::1")).toBe("::1");
    expect(hostOf("fe80::1")).toBe("fe80::1");
  });

  it("normalises case and tolerates empty input", () => {
    expect(hostOf("LOCALHOST:3000")).toBe("localhost");
    expect(hostOf(null)).toBe("");
    expect(hostOf(undefined)).toBe("");
  });
});

describe("isLoopbackHost", () => {
  it("accepts the machine's own names, with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000", "::1"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects a LAN address, which is the whole point", () => {
    for (const host of ["192.168.1.42:3000", "10.0.0.5", "evil.example:3000", ""]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it("rejects 0.0.0.0, which is a bind address and not a destination", () => {
    // A caller could send `Host: 0.0.0.0`; treating it as loopback would
    // let it through the local gate.
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("0.0.0.0:3000")).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("accepts only an exact match", () => {
    expect(tokenMatches("s3cret", "s3cret")).toBe(true);
    expect(tokenMatches("s3cret ", "s3cret")).toBe(false);
    expect(tokenMatches("s3cre", "s3cret")).toBe(false);
    expect(tokenMatches("", "s3cret")).toBe(false);
  });

  it("refuses when no token is configured", () => {
    expect(tokenMatches("anything", undefined)).toBe(false);
    expect(tokenMatches("anything", "")).toBe(false);
  });
});

/**
 * Mode selection and the allowlist. The important properties: nothing
 * defaults to `off`, an unknown setting fails closed, and a forged
 * `X-Forwarded-Host` cannot make a remote caller look local.
 */
describe("resolveGateMode", () => {
  it("honours every explicit mode", () => {
    for (const mode of ["local", "hosts", "token", "off"] as const) {
      expect(resolveGateMode({ NUTRIPLAN_GATE: mode })).toBe(mode);
    }
  });

  it("fails closed on an unknown or empty explicit value", () => {
    expect(resolveGateMode({ NUTRIPLAN_GATE: "open" })).toBe("local");
    expect(resolveGateMode({ NUTRIPLAN_GATE: "" })).toBe("local");
    expect(resolveGateMode({})).toBe("local");
  });

  it("infers the mode from the setting a deployment actually provides", () => {
    expect(resolveGateMode({ NUTRIPLAN_ALLOWED_HOSTS: "app.example.com" })).toBe("hosts");
    expect(resolveGateMode({ NUTRIPLAN_TOKEN: "s3cret" })).toBe("token");
    // An explicit mode wins over inference.
    expect(
      resolveGateMode({ NUTRIPLAN_GATE: "local", NUTRIPLAN_ALLOWED_HOSTS: "app.example.com" }),
    ).toBe("local");
  });
});

describe("hostMatches", () => {
  it("matches exact hosts with or without a port", () => {
    expect(hostMatches("app.example.com", ["app.example.com"])).toBe(true);
    expect(hostMatches("app.example.com:8443", ["app.example.com:8443"])).toBe(true);
    expect(hostMatches("APP.example.com", ["app.example.com"])).toBe(true);
  });

  it("matches wildcard subdomains but not the bare domain", () => {
    expect(hostMatches("app.example.com", ["*.example.com"])).toBe(true);
    expect(hostMatches("eu.app.example.com", ["*.example.com"])).toBe(true);
    expect(hostMatches("example.com", ["*.example.com"])).toBe(false);
  });

  it("does not match a different host or an empty one", () => {
    expect(hostMatches("evil.example", ["app.example.com"])).toBe(false);
    expect(hostMatches("", ["app.example.com"])).toBe(false);
    expect(hostMatches("notapp.example.com", ["app.example.com"])).toBe(false);
  });

  it("parses a comma list, trimming and lowercasing", () => {
    expect(parseAllowedHosts(" A.example.com , *.b.example.com ,")).toEqual([
      "a.example.com",
      "*.b.example.com",
    ]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });
});

describe("decideGate", () => {
  const base = {
    mode: "local" as const,
    host: "app.example.com",
    trustProxy: false,
    allowedHosts: [] as string[],
  };

  it("allows everything when the gate is off", () => {
    expect(decideGate({ ...base, mode: "off" }).via).toBe("off");
  });

  it("local: loopback in, public out", () => {
    expect(decideGate({ ...base, host: "localhost:3000" }).via).toBe("loopback");
    expect(decideGate(base).allow).toBe(false);
  });

  it("hosts: only the allowlist, loopback included", () => {
    const hosts = { ...base, mode: "hosts" as const, allowedHosts: ["app.example.com"] };
    expect(decideGate(hosts).via).toBe("host");
    expect(decideGate({ ...hosts, host: "other.example" }).allow).toBe(false);
    // A proxy that rewrites Host to its loopback upstream must not bypass
    // the allowlist: loopback is a claim in this mode, not a fact.
    expect(decideGate({ ...hosts, host: "localhost:3000" }).allow).toBe(false);
    // It is reachable when the operator explicitly allows it.
    expect(
      decideGate({ ...hosts, host: "localhost:3000", allowedHosts: ["localhost"] }).via,
    ).toBe("host");
  });

  it("token: exact match only, loopback included", () => {
    const token = { ...base, mode: "token" as const, expectedToken: "s3cret" };
    expect(decideGate({ ...token, providedToken: "s3cret" }).via).toBe("token");
    expect(decideGate({ ...token, providedToken: "wrong" }).allow).toBe(false);
    expect(decideGate({ ...token, providedToken: null }).allow).toBe(false);
    // Loopback does not shortcut the token check.
    expect(
      decideGate({ ...token, host: "localhost:3000", providedToken: null }).allow,
    ).toBe(false);
  });

  it("ignores a forged X-Forwarded-Host unless the operator trusts a proxy", () => {
    const spoof = { ...base, forwardedHost: "localhost:3000" };
    // Default: the header is client-writable, so it must not help.
    expect(decideGate(spoof).allow).toBe(false);
    // With NUTRIPLAN_TRUST_PROXY=1 the proxy is expected to overwrite it.
    expect(decideGate({ ...spoof, trustProxy: true }).via).toBe("loopback");
  });
});
