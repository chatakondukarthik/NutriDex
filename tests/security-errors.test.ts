import { describe, expect, it } from "vitest";
import { redact, safeLogText, publicError, ownMessage, UserFacingError } from "@/lib/security/errors";
import { rateLimit, resetRateLimits } from "@/lib/security/rate-limit";

/**
 * Error hygiene: nothing the server knows (paths, keys, provider bodies)
 * reaches the browser, and outbound search actions cannot be looped
 * unboundedly.
 */

describe("redact", () => {
  it("strips every key shape the app can hold", () => {
    const input = [
      "failed: sk-proj-abc123def456ghi789",
      "key AIzaSyA1234567890abcdefghijk",
      "api_key=DEMO_KEY123",
      "header Authorization: Bearer xyz",
      "x-api-key: sk-abcdefghij",
      "opened /Users/karthik/Documents/Projects/NutriDex/data/secrets.json",
      "sqlite error at data/nutriplan.sqlite",
    ].join("\n");
    const out = redact(input);
    expect(out).not.toMatch(/sk-proj-/);
    expect(out).not.toMatch(/AIza/);
    expect(out).not.toMatch(/Bearer xyz/);
    expect(out).not.toMatch(/\/Users\//);
    expect(out).not.toMatch(/secrets\.json/);
    expect(out).not.toMatch(/nutriplan\.sqlite/);
  });

  it("leaves ordinary sentences alone", () => {
    expect(redact("Connection failed.")).toBe("Connection failed.");
  });
});

describe("safeLogText", () => {
  it("truncates and redacts what is stored in ai_calls.error", () => {
    const stored = safeLogText(`HTTP 401: ${"x".repeat(1000)} sk-abcdefghijklmnop`, 300);
    expect(stored!.length).toBeLessThanOrEqual(300);
    expect(stored).not.toMatch(/sk-abcdefghijklmnop/);
  });

  it("passes null through", () => {
    expect(safeLogText(null)).toBeNull();
  });
});

describe("publicError", () => {
  it("returns only the fixed sentence regardless of what the error said", () => {
    const err = new Error("ENOENT: /Users/x/data/nutriplan.sqlite missing, key sk-abcdefghijklmno");
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.join(" "));
    });
    try {
      expect(publicError("Could not save the recipe.", err, "saveRecipeAction")).toBe(
        "Could not save the recipe.",
      );
      // Detail still reaches the server log, redacted — diagnosis survives.
      expect(logged.join(" ")).toContain("saveRecipeAction");
      expect(logged.join(" ")).not.toMatch(/sk-abcdefghijklmno/);
      expect(logged.join(" ")).not.toMatch(/\/Users\//);
    } finally {
      spy.mockRestore();
    }
  });

  it("handles non-Error throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(publicError("Import failed.", "boom", "importInndbAction")).toBe("Import failed.");
    } finally {
      spy.mockRestore();
    }
  });

  it("passes an app-authored UserFacingError through, redacted", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = new UserFacingError(
        "No key is bound to api.example.com. Re-enter the key in Settings.",
      );
      expect(publicError("AI call failed.", error, "complete")).toMatch(
        /Re-enter the key in Settings/,
      );

      const leaky = new UserFacingError("failed with sk-abcdefghijklmno");
      expect(publicError("AI call failed.", leaky, "complete")).not.toMatch(/sk-abcdefghijklmno/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("ownMessage", () => {
  it("keeps short app-authored validation text", () => {
    expect(ownMessage(new Error("Servings must be a positive number."), "x")).toBe(
      "Servings must be a positive number.",
    );
  });

  it("falls back for long, untrusted text instead of echoing it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(ownMessage(new Error("y".repeat(500)), "Something went wrong.")).toBe(
        "Something went wrong.",
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("rateLimit", () => {
  it("allows up to the limit, then refuses with a retry hint", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(rateLimit("t:1", 3, 60_000).ok).toBe(true);
    const blocked = rateLimit("t:1", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("keeps keys independent", () => {
    resetRateLimits();
    expect(rateLimit("t:a", 1, 60_000).ok).toBe(true);
    expect(rateLimit("t:a", 1, 60_000).ok).toBe(false);
    expect(rateLimit("t:b", 1, 60_000).ok).toBe(true);
  });

  it("refills after the window", () => {
    resetRateLimits();
    // Time is mocked rather than slept on: a 1 ms real window made this
    // depend on how fast the next statement ran.
    const now = vi.spyOn(Date, "now");
    let t = 1_000_000;
    now.mockReturnValue(t);
    try {
      expect(rateLimit("t:r", 2, 60_000).ok).toBe(true);
      expect(rateLimit("t:r", 2, 60_000).ok).toBe(true);
      expect(rateLimit("t:r", 2, 60_000).ok).toBe(false);

      now.mockReturnValue((t += 30_000)); // half a window → exactly one token back
      expect(rateLimit("t:r", 2, 60_000).ok).toBe(true);
      expect(rateLimit("t:r", 2, 60_000).ok).toBe(false);
    } finally {
      now.mockRestore();
      resetRateLimits();
    }
  });
});

// Vitest globals are configured in this project; import defensively so the
// spy calls above work even if globals are ever turned off.
import { vi } from "vitest";
