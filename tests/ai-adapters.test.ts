import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "@/lib/ai/adapters";

/**
 * Two properties of `fetchJson` that are invisible from the call sites:
 * redirects are refused (the SSRF guard only validated the original URL) and
 * the response body is capped before it is buffered.
 */

const request = {
  capability: "text",
  prompt: "ping",
  temperature: 0,
} as const;

beforeEach(() => {
  vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "sk-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider fetch", () => {
  it("refuses redirects instead of carrying the key to a new host", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await getAdapter("openai").complete(
      { provider: "openai", model: "gpt-test" } as never,
      request as never,
    );

    expect(result.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
  });

  it("rejects a response whose declared size exceeds the cap", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    );

    await expect(
      getAdapter("openai").complete(
        { provider: "openai", model: "gpt-test" } as never,
        request as never,
      ),
    ).rejects.toThrow(/Response too large/);
  });
});
