import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiConfig, ModelResponse } from "@/lib/ai/types";

/**
 * Resilience (S7.2).
 *
 * Two behaviours matter: a transient provider failure is retried with
 * backoff before it is believed, and a provider that is down falls through
 * to the configured fallback instead of failing the user's request. Every
 * outbound attempt is still counted against the daily cap, including the
 * ones that fail, because retries are real spend.
 */

const adapters: Record<string, { complete: ReturnType<typeof vi.fn> }> = {};
let config: AiConfig;

vi.mock("@/lib/ai/config", () => ({
  readAiConfig: () => config,
  defaultAiConfig: () => ({ enabled: true, provider: "gemini", model: "gemini-2.0-flash" }),
}));

vi.mock("@/lib/ai/secrets", () => ({
  hasKey: (provider: string) => provider in adapters,
  getKey: () => "test-key",
}));

vi.mock("@/lib/ai/adapters", () => ({
  getAdapter: (provider: string) => {
    const adapter = adapters[provider];
    if (!adapter) throw new Error(`No adapter for ${provider}.`);
    return adapter;
  },
}));

let dir: string;
let complete: typeof import("@/lib/ai/client")["complete"];
let primaryFor: typeof import("@/lib/ai/client")["primaryFor"];
let fallbackFor: typeof import("@/lib/ai/client")["fallbackFor"];
let db: typeof import("@/lib/db/client")["db"];

const request = {
  capability: "text" as const,
  system: "",
  prompt: "What is in paneer?",
};

function reply(text: string): ModelResponse {
  return { text, latencyMs: 5 };
}

function failWith(message: string): Promise<ModelResponse> {
  return Promise.reject(new Error(message));
}

function resetAdapters(): void {
  for (const key of Object.keys(adapters)) delete adapters[key];
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-ai-resilience-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);
  ({ complete, primaryFor, fallbackFor } = await import("@/lib/ai/client"));
  ({ db } = await import("@/lib/db/client"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db?.exec("DELETE FROM ai_calls");
});

afterEach(() => {
  vi.useRealTimers();
  resetAdapters();
});

describe("provider selection", () => {
  it("uses the image pair for vision and the text pair otherwise", () => {
    const cfg: AiConfig = {
      provider: "gemini",
      model: "text-model",
      imageProvider: "openai",
      imageModel: "vision-model",
      fallbackProvider: "anthropic",
      fallbackModel: "fallback-model",
      imageFallbackProvider: "openai-compatible",
      imageFallbackModel: "image-fallback",
    };

    expect(primaryFor(cfg, "text")).toMatchObject({ provider: "gemini", model: "text-model" });
    expect(primaryFor(cfg, "vision")).toMatchObject({ provider: "openai", model: "vision-model" });
    expect(fallbackFor(cfg, "text")).toMatchObject({ provider: "anthropic", model: "fallback-model" });
    expect(fallbackFor(cfg, "vision")).toMatchObject({
      provider: "openai-compatible",
      model: "image-fallback",
    });
  });

  it("has no fallback when none is configured", () => {
    expect(fallbackFor({ provider: "gemini", model: "x" }, "text")).toBeNull();
  });
});

describe("retry and fallback", () => {
  it("retries a transient failure with backoff, then succeeds", async () => {
    config = { provider: "gemini", model: "primary", dailyCallCap: 10 };
    const completeMock = vi
      .fn()
      .mockImplementationOnce(() => failWith("HTTP 503 service unavailable"))
      .mockImplementationOnce(() => failWith("HTTP 503 service unavailable"))
      .mockResolvedValueOnce(reply("third time lucky"));
    adapters.gemini = { complete: completeMock };

    vi.useFakeTimers();
    const promise = complete(request);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 10);
    await expect(promise).resolves.toMatchObject({ text: "third time lucky" });

    expect(completeMock).toHaveBeenCalledTimes(3);
    const calls = db
      .prepare(`SELECT provider, status FROM ai_calls ORDER BY created_at, rowid`)
      .all() as unknown as Array<{ provider: string; status: string }>;
    expect(calls.map((call) => call.status)).toEqual(["failed", "failed", "ok"]);
    expect(calls.every((call) => call.provider === "gemini")).toBe(true);
  });

  it("falls back to the configured provider after a non-transient failure", async () => {
    config = {
      provider: "gemini",
      model: "primary",
      fallbackProvider: "openai",
      fallbackModel: "backup",
      dailyCallCap: 10,
    };
    adapters.gemini = { complete: vi.fn(() => failWith("HTTP 400 bad request")) };
    adapters.openai = { complete: vi.fn().mockResolvedValue(reply("from the fallback")) };

    await expect(complete(request)).resolves.toMatchObject({ text: "from the fallback" });

    const calls = db
      .prepare(`SELECT provider, status FROM ai_calls ORDER BY created_at, rowid`)
      .all() as unknown as Array<{ provider: string; status: string }>;
    expect(calls.map((call) => `${call.provider}:${call.status}`)).toEqual([
      "gemini:failed",
      "openai:ok",
    ]);
  });

  it("does not fall back when the daily cap is already spent", async () => {
    config = {
      provider: "gemini",
      model: "primary",
      fallbackProvider: "openai",
      fallbackModel: "backup",
      dailyCallCap: 1,
    };
    adapters.gemini = { complete: vi.fn(() => failWith("HTTP 400 bad request")) };
    const fallbackMock = vi.fn().mockResolvedValue(reply("should not run"));
    adapters.openai = { complete: fallbackMock };

    await expect(complete(request)).rejects.toThrow(/call limit/i);
    expect(fallbackMock).not.toHaveBeenCalled();
  });

  it("skips a provider with no key and still uses the fallback", async () => {
    config = {
      provider: "gemini",
      model: "primary",
      fallbackProvider: "anthropic",
      fallbackModel: "backup",
      dailyCallCap: 10,
    };
    adapters.anthropic = { complete: vi.fn().mockResolvedValue(reply("fallback with a key")) };

    await expect(complete(request)).resolves.toMatchObject({ text: "fallback with a key" });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ai_calls`).get() as unknown as { n: number };
    // The keyless primary never reached the provider, so it was not charged.
    expect(count.n).toBe(1);
  });
});
