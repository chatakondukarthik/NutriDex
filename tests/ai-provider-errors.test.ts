import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "@/lib/ai/adapters";
import {
  aiFailure,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
} from "@/lib/ai/errors";

/**
 * Provider failures must say *why* they failed without leaking the key or
 * the response body wholesale. The old `fetchJson` threw a plain `Error`,
 * which `publicError` correctly hid behind "Connection failed." — safe, but
 * useless when the answer was "that model no longer exists".
 *
 * These tests pin the contract: the status and the provider's own sentence
 * survive, flattened and redacted, while the key does not.
 */

vi.mock("@/lib/ai/secrets", () => ({
  getKey: () => "test-key",
  getKeyForHost: () => "test-key",
}));

const request = {
  capability: "text",
  prompt: "ping",
  temperature: 0,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider failures", () => {
  it("keeps the status and the model hint from a Gemini 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 404,
            message:
              "models/gemini-2.0-flash is not found for API version v1beta. " +
              "Use models/gemini-3.8-flash instead.",
            status: "NOT_FOUND",
          },
        }),
        { status: 404 },
      ),
    );

    const error = await getAdapter("gemini")
      .complete({ provider: "gemini", model: "gemini-2.0-flash" } as never, request as never)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.status).toBe(404);
    expect(error.publicMessage).toContain("HTTP 404");
    expect(error.publicMessage).toContain("gemini-3.8-flash");
  });

  it("redacts a key echoed back inside the provider message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "bad key AIzaLEAK1234567890" } }),
        { status: 401 },
      ),
    );

    const error = await getAdapter("gemini")
      .complete({ provider: "gemini", model: "any" } as never, request as never)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.publicMessage).toContain("HTTP 401");
    expect(error.publicMessage).not.toMatch(/AIzaLEAK/);
  });

  it("turns a timeout into a sentence a user can act on", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );

    const error = await getAdapter("openai")
      .complete({ provider: "openai", model: "gpt-test" } as never, request as never)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderTimeoutError);
    expect(error.publicMessage).toMatch(/did not respond/i);
  });

  it("names a connection failure instead of blaming the model", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const error = await getAdapter("openai")
      .complete({ provider: "openai", model: "gpt-test" } as never, request as never)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderNetworkError);
    expect(error.publicMessage).toMatch(/Could not reach the provider/);
  });
});

describe("aiFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies a provider failure and builds a copyable line", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new ProviderHttpError(404, "models/gemini-2.0-flash is not found");

    const failure = aiFailure("Connection failed.", error, {
      action: "testAiConnectionAction",
      provider: "gemini",
      model: "gemini-2.0-flash",
    });

    expect(failure.kind).toBe("http");
    expect(failure.message).toContain("HTTP 404");
    expect(failure.detail).toContain("action=testAiConnectionAction");
    expect(failure.detail).toContain("type=http");
    expect(failure.detail).toContain("provider=gemini");
    expect(failure.detail).toContain("model=gemini-2.0-flash");
    expect(failure.detail).toContain("is not found");
  });

  it("never copies a key into the diagnostic line", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new ProviderHttpError(401, "bad key AIzaLEAK1234567890");

    const failure = aiFailure("Connection failed.", error, {
      action: "testAiConnectionAction",
      provider: "gemini",
    });

    expect(failure.detail).not.toMatch(/AIzaLEAK/);
    expect(failure.message).not.toMatch(/AIzaLEAK/);
  });

  it("classifies timeouts and network failures separately", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      aiFailure("x", new ProviderTimeoutError(20_000), { action: "test" }).kind,
    ).toBe("timeout");
    expect(
      aiFailure("x", new ProviderNetworkError(), { action: "test" }).kind,
    ).toBe("network");
  });

  it("falls back to the fixed sentence for an unknown error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failure = aiFailure("Connection failed.", new Error("boom"), {
      action: "testAiConnectionAction",
    });

    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("Connection failed.");
    expect(failure.detail).toContain("message=boom");
  });
});
