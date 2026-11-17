import { describe, expect, it } from "vitest";
import { isCrossSiteMutation } from "@/lib/security/gate";

/**
 * CSRF check for state-changing requests.
 *
 * Next's own action origin check passes a request with no `Origin`. This one
 * runs first and is stricter: a browser-reported `Sec-Fetch-Site` must be
 * `same-origin`, and a present `Origin` must match the request authority (or
 * a configured public origin).
 */

function request(method: string, headers: Record<string, string> = {}) {
  return { method, headers: new Headers(headers) };
}

describe("isCrossSiteMutation", () => {
  it("ignores safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isCrossSiteMutation(request(method), "localhost:3000")).toBe(false);
    }
  });

  it("allows a same-origin POST", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" }),
        "localhost:3000",
      ),
    ).toBe(false);
  });

  it("rejects Sec-Fetch-Site: none on a mutation", () => {
    // `none` is a typed URL / address-bar navigation, never a server action.
    expect(
      isCrossSiteMutation(request("POST", { "sec-fetch-site": "none" }), "localhost:3000"),
    ).toBe(true);
  });

  it.each(["cross-site", "same-site"])("rejects Sec-Fetch-Site: %s", (site) => {
    expect(
      isCrossSiteMutation(request("POST", { "sec-fetch-site": site }), "localhost:3000"),
    ).toBe(true);
  });

  it("rejects an Origin for a different host", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://evil.example" }),
        "localhost:3000",
      ),
    ).toBe(true);
  });

  it("treats a non-default port as a different origin", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "http://localhost:4000" }),
        "localhost:3000",
      ),
    ).toBe(true);
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "http://localhost:3000" }),
        "localhost:3000",
      ),
    ).toBe(false);
  });

  it("normalises a default port added or dropped by a proxy", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://app.example.com:443" }),
        "app.example.com",
      ),
    ).toBe(false);
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://app.example.com" }),
        "app.example.com:443",
      ),
    ).toBe(false);
  });

  it("accepts an Origin listed in NUTRIPLAN_ALLOWED_ORIGINS", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://public.example.com" }),
        "127.0.0.1:3000",
        ["public.example.com"],
      ),
    ).toBe(false);
  });

  it("keeps the port significant for an allowlisted origin", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "http://public.example.com:9999" }),
        "127.0.0.1:3000",
        ["public.example.com"],
      ),
    ).toBe(true);
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "http://public.example.com:8443" }),
        "127.0.0.1:3000",
        ["public.example.com:8443"],
      ),
    ).toBe(false);
  });

  it("supports a wildcard subdomain without matching the bare domain", () => {
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://app.example.com" }),
        "127.0.0.1:3000",
        ["*.example.com"],
      ),
    ).toBe(false);
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://example.com" }),
        "127.0.0.1:3000",
        ["*.example.com"],
      ),
    ).toBe(true);
    expect(
      isCrossSiteMutation(
        request("POST", { origin: "https://app.example.com:9999" }),
        "127.0.0.1:3000",
        ["*.example.com"],
      ),
    ).toBe(true);
  });

  it("rejects a malformed Origin and passes a header-less non-browser client", () => {
    expect(isCrossSiteMutation(request("POST", { origin: "not a url" }), "localhost:3000")).toBe(
      true,
    );
    // curl sends neither header; the gate and token rules still apply.
    expect(isCrossSiteMutation(request("POST"), "localhost:3000")).toBe(false);
  });
});
