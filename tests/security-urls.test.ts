import { afterEach, describe, expect, it } from "vitest";
import {
  checkUrlSyntax,
  validateOutboundUrl,
  assertOutboundUrl,
  clearUrlCache,
} from "@/lib/security/urls";

/**
 * SSRF / credential-exfiltration guard.
 *
 * `baseUrl` reaches the adapters with an API key attached as a Bearer
 * header, so every rejection here is also "the key did not leave".
 * BYO_LLM §11: https only, no private/link-local ranges, no credentials.
 */

afterEach(() => {
  clearUrlCache();
  delete process.env.NUTRIPLAN_ALLOW_PRIVATE_AI_URLS;
});

describe("checkUrlSyntax", () => {
  it("accepts a normal https endpoint", () => {
    const r = checkUrlSyntax("https://api.example.com/v1/");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://api.example.com/v1");
  });

  it("rejects plain http, which would send the key in the clear", () => {
    expect(checkUrlSyntax("http://api.example.com").ok).toBe(false);
  });

  it("rejects a scheme that is not http(s)", () => {
    for (const url of ["ftp://example.com", "file:///etc/passwd", "gopher://x/1"]) {
      expect(checkUrlSyntax(url).ok).toBe(false);
    }
  });

  it("rejects embedded credentials", () => {
    const r = checkUrlSyntax("https://user:pass@api.example.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/username\/password/i);
  });

  it("rejects link-local addresses even with the local opt-in", () => {
    process.env.NUTRIPLAN_ALLOW_PRIVATE_AI_URLS = "1";
    // The cloud metadata endpoint — the reason link-local is never allowed.
    expect(checkUrlSyntax("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(checkUrlSyntax("https://[fe80::1]/").ok).toBe(false);
  });

  it("rejects loopback and private ranges by default", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "https://127.0.0.1:8443",
      "https://10.0.0.5/v1",
      "https://192.168.1.10/v1",
      "https://172.16.0.1/v1",
      "https://100.64.0.1/v1",
      "https://[::1]:1234/v1",
      "https://[fd00::1]/v1",
    ]) {
      expect(checkUrlSyntax(url).ok, url).toBe(false);
    }
  });

  it("allows loopback only behind the explicit env opt-in", () => {
    process.env.NUTRIPLAN_ALLOW_PRIVATE_AI_URLS = "1";
    expect(checkUrlSyntax("http://localhost:11434/v1").ok).toBe(true);
    expect(checkUrlSyntax("https://127.0.0.1:8443/v1").ok).toBe(true);
    // …but a hostile public address stays usable either way.
    expect(checkUrlSyntax("https://attacker.example/collect").ok).toBe(true);
  });

  it("rejects nonsense rather than throwing", () => {
    for (const url of ["", "   ", "not a url", "https://", "\u0000"]) {
      const r = checkUrlSyntax(url);
      expect(r.ok, JSON.stringify(url)).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });

  it("rejects an over-long URL outright", () => {
    expect(checkUrlSyntax(`https://example.com/${"a".repeat(3000)}`).ok).toBe(false);
  });

  it("treats an unparseable host as unsafe (fail closed)", () => {
    // IP-shaped hosts the URL parser refuses to normalise never reach the
    // DNS step, so they are rejected outright.
    expect(checkUrlSyntax("https://999.1.1.1/").ok).toBe(false);
    expect(checkUrlSyntax("https://1.2.3.4.5/").ok).toBe(false);
    // `1.2.3` is a different case: the WHATWG parser normalises it to the
    // literal `1.2.0.3` before we see it, and that public address is then
    // judged by the ordinary IPv4 range check.
    expect(checkUrlSyntax("https://1.2.3/").ok).toBe(true);
  });
});

describe("validateOutboundUrl", () => {
  it("rejects a hostname that resolves into a private range (DNS rebinding)", async () => {
    // `localtest.me` resolves to 127.0.0.1. If that lookup ever fails in a
    // sandbox the assertion still holds, because a resolution failure is
    // also a rejection — never a pass.
    const r = await validateOutboundUrl("https://localtest.me/v1");
    expect(r.ok).toBe(false);
  });

  it("accepts a syntactically valid public host", async () => {
    const r = await validateOutboundUrl("https://api.openai.com/v1");
    // Either it resolves publicly (ok) or DNS is unavailable (rejected);
    // the important half is that a rejection is never silent.
    if (!r.ok) expect(r.reason).toBeTruthy();
    else expect(r.url).toContain("https://api.openai.com");
  });
});

describe("assertOutboundUrl", () => {
  it("throws a message that names the policy, not the internals", async () => {
    await expect(assertOutboundUrl("http://169.254.169.254/")).rejects.toThrow(/link-local/i);
  });

  it("returns the normalised URL when allowed", async () => {
    // A literal public IP: allowed by the syntax check and needing no DNS
    // lookup, so this asserts the success path even where sandboxed.
    await expect(assertOutboundUrl("https://93.184.216.34/v1/")).resolves.toBe(
      "https://93.184.216.34/v1",
    );
  });
});
