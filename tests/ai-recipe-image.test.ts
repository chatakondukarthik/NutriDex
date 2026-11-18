import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiConfig, ModelResponse } from "@/lib/ai/types";

/**
 * Recipes from AI can now start from a photo — a recipe card, a dish, the
 * pantry. The guarantee under test: attaching an image routes the call to
 * the vision capability and forwards the image bytes; without one, nothing
 * about the old text-only path changes.
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

const PNG = Buffer.alloc(32, 7).toString("base64");
const PLAN = JSON.stringify({
  name: "Paneer rice",
  servings: 2,
  instructions: "Boil, then fold in.",
  steps: [
    { name: "Boil rice", operation: "boil", inputs: [{ foodName: "Paneer", grams: 100 }], consumes: [] },
  ],
});

function reply(): ModelResponse {
  return { text: PLAN, latencyMs: 5 };
}

function resetAdapters(): void {
  for (const key of Object.keys(adapters)) delete adapters[key];
}

let dir: string;
let planRecipeFromPrompt: typeof import("@/lib/ai-generate-recipe")["planRecipeFromPrompt"];
let db: typeof import("@/lib/db/client")["db"];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-recipe-image-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);
  ({ planRecipeFromPrompt } = await import("@/lib/ai-generate-recipe"));
  ({ db } = await import("@/lib/db/client"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetAdapters();
  db.exec("DELETE FROM ai_calls");
  config = { enabled: true, provider: "gemini", model: "gemini-2.0-flash", dailyCallCap: 100 };
  adapters.gemini = { complete: vi.fn(async () => reply()) };
});

describe("planRecipeFromPrompt with an image", () => {
  it("routes to the vision capability and forwards the image untouched", async () => {
    const plan = await planRecipeFromPrompt("quick lunch", undefined, [
      { mimeType: "image/png", data: PNG },
    ]);

    expect(plan.name).toBe("Paneer rice");
    expect(adapters.gemini.complete).toHaveBeenCalledTimes(1);
    const request = adapters.gemini.complete.mock.calls[0][1] as {
      capability: string;
      images?: Array<{ mimeType: string; data: string }>;
      prompt: string;
    };
    expect(request.capability).toBe("vision");
    expect(request.images).toEqual([{ mimeType: "image/png", data: PNG }]);
    expect(request.prompt).toContain("quick lunch");
  });

  it("stays on the text capability and sends no image without one", async () => {
    await planRecipeFromPrompt("quick lunch");

    const request = adapters.gemini.complete.mock.calls[0][1] as {
      capability: string;
      images?: Array<{ mimeType: string; data: string }>;
    };
    expect(request.capability).toBe("text");
    expect(request.images).toBeUndefined();
  });

  it("accepts a photo with no text at all", async () => {
    const plan = await planRecipeFromPrompt("", undefined, [
      { mimeType: "image/png", data: PNG },
    ]);

    expect(plan.name).toBe("Paneer rice");
    const request = adapters.gemini.complete.mock.calls[0][1] as {
      capability: string;
      prompt: string;
    };
    expect(request.capability).toBe("vision");
    expect(request.prompt).toContain("photo");
  });

  it("refuses an empty request with no image", async () => {
    await expect(planRecipeFromPrompt("   ")).rejects.toThrow(/Ask me something/i);
    expect(adapters.gemini.complete).not.toHaveBeenCalled();
  });
});
