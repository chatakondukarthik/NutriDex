import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiConfig, ModelResponse } from "@/lib/ai/types";

/**
 * Food-image extraction ladder.
 *
 * The user's default setup is a small primary model (flash-lite). When it
 * comes back with an answer a human would call empty, the app re-asks with
 * the fallback model once, then with the correction prompt once. Two calls
 * at most beyond the base one. The first call wins when its read is strong.
 */

const adapters: Record<string, { complete: ReturnType<typeof vi.fn> }> = {};
let config: AiConfig;

vi.mock("@/lib/ai/config", () => ({
  readAiConfig: () => config,
  defaultAiConfig: () => ({ enabled: true, provider: "gemini", model: "gemini-flash-lite-latest" }),
}));

vi.mock("@/lib/ai/secrets", () => ({
  hasKey: () => true,
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
const WEAK = JSON.stringify({ name: "MiliD High Protein Flour", aliases: ["Roti Flour"] });
const FULL = JSON.stringify({
  name: "MiliD High Protein Flour",
  basis: "per_100g",
  category: "Grains",
  kind: "branded",
  nutrients: { ENERC_KCAL: 387.44, PROCNT: 46.16 },
  rationale: "From the per 100 g column.",
});
const STRONG = JSON.stringify({
  name: "MiliD High Protein Flour",
  basis: "per_100g",
  category: "Grains",
  kind: "branded",
  nutrients: { ENERC_KCAL: 387.44, PROCNT: 46.16, CHOCDF: 45.48, FAT: 2.32 },
  rationale: "From the per 100 g column.",
});

function reply(text: string): ModelResponse {
  return { text, latencyMs: 5 };
}

function resetAdapters(): void {
  for (const key of Object.keys(adapters)) delete adapters[key];
}

/** The two models fan out to the same provider here, mirroring the user's setup. */
function mockProvider(handler: (model: string, prompt: string) => ModelResponse) {
  adapters.gemini = {
    complete: vi.fn(async (cfg: { model: string }, request: { prompt: string }) =>
      handler(cfg.model, request.prompt),
    ),
  };
}

let dir: string;
let extractFoodFromImage: typeof import("@/lib/ai/extract")["extractFoodFromImage"];
let extractFoodFromText: typeof import("@/lib/ai/extract")["extractFoodFromText"];
let db: typeof import("@/lib/db/client")["db"];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-extract-fallback-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);
  ({ extractFoodFromImage, extractFoodFromText } = await import("@/lib/ai/extract"));
  ({ db } = await import("@/lib/db/client"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetAdapters();
  db?.exec("DELETE FROM ai_calls");
  config = {
    enabled: true,
    provider: "gemini",
    model: "gemini-flash-lite-latest",
    fallbackProvider: "gemini",
    fallbackModel: "gemini-3.5-flash",
    dailyCallCap: 20,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extractFoodFromImage ladder", () => {
  it("escalates from the weak primary to the stronger fallback and wins", async () => {
    mockProvider((model) =>
      model === "gemini-flash-lite-latest" ? reply(WEAK) : reply(STRONG),
    );

    const result = await extractFoodFromImage([{ mimeType: "image/png", data: PNG }]);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(2);
    expect(result.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(result.nutrients?.PROCNT).toBe(46.16);
    const models = adapters.gemini.complete.mock.calls.map((call) => (call[0] as { model: string }).model);
    expect(models).toEqual(["gemini-flash-lite-latest", "gemini-3.5-flash"]);
  });

  it("accepts a strong first answer and stops there", async () => {
    mockProvider(() => reply(STRONG));

    const result = await extractFoodFromImage([{ mimeType: "image/png", data: PNG }]);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(1);
    expect(result.nutrients?.FAT).toBe(2.32);
  });

  it("keeps the first answer when the fallback is also empty and correction finds nothing", async () => {
    mockProvider(() => reply(WEAK));

    const result = await extractFoodFromImage([{ mimeType: "image/png", data: PNG }]);

    expect(result.name).toBe("MiliD High Protein Flour");
    expect(result.nutrients).toBeUndefined();
    expect(adapters.gemini.complete).toHaveBeenCalledTimes(3);
  });

  it("keeps the first answer when the correction call fails", async () => {
    let calls = 0;
    mockProvider(() => {
      calls += 1;
      if (calls === 3) throw new Error("provider down");
      return reply(WEAK);
    });

    const result = await extractFoodFromImage([{ mimeType: "image/png", data: PNG }]);

    expect(result.name).toBe("MiliD High Protein Flour");
    expect(result.nutrients).toBeUndefined();
  });

  it("correction returns a usable answer from an empty fallback", async () => {
    mockProvider((model, prompt) => {
      if (model === "gemini-flash-lite-latest") return reply(WEAK);
      if (prompt.includes("misses printed nutrients")) return reply(FULL);
      return reply(WEAK);
    });

    const result = await extractFoodFromImage([{ mimeType: "image/png", data: PNG }]);

    expect(result.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(adapters.gemini.complete).toHaveBeenCalledTimes(3);
  });

});

describe("extractFoodFromText ladder", () => {
  const DESCRIPTION =
    "MiliD High Protein Flour — Whole Wheat. Per 100 g: Energy 344.63 kcal, Protein 67.00 g, " +
    "Carbohydrate 11.23 g, Total Sugars 1.19 g, Added Sugars 0.00 g, Total Fat 3.52 g, " +
    "Saturated Fat 0.97 g, Dietary Fiber 8.83 g, Sodium 355.80 mg.";

  it("escalates a weak text read to the fallback and wins", async () => {
    mockProvider((model) => (model === "gemini-flash-lite-latest" ? reply(WEAK) : reply(STRONG)));

    const result = await extractFoodFromText(DESCRIPTION);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(2);
    expect(result.nutrients?.ENERC_KCAL).toBe(387.44);
    const models = adapters.gemini.complete.mock.calls.map((call) => (call[0] as { model: string }).model);
    expect(models).toEqual(["gemini-flash-lite-latest", "gemini-3.5-flash"]);
  });

  it("accepts a strong text answer and stops there", async () => {
    mockProvider(() => reply(STRONG));

    const result = await extractFoodFromText(DESCRIPTION);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(1);
    expect(result.nutrients?.CHOCDF).toBe(45.48);
  });

  it("correction re-ask fills a partial read the fallback also missed", async () => {
    const PARTIAL = JSON.stringify({
      name: "MiliD High Protein Flour",
      basis: "per_100g",
      nutrients: { ENERC_KCAL: 344.63, PROCNT: 67, SUGAR: 1.19 },
    });
    mockProvider((model, prompt) => {
      if (prompt.includes("misses printed nutrients")) return reply(FULL);
      return reply(PARTIAL);
    });

    const result = await extractFoodFromText(DESCRIPTION);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(3);
    expect(result.nutrients?.ENERC_KCAL).toBe(387.44);
  });

  it("correction is refused when it carries fewer anchors than the answer it replaces", async () => {
    const TWO = JSON.stringify({
      name: "MiliD High Protein Flour",
      basis: "per_100g",
      nutrients: { ENERC_KCAL: 344.63, PROCNT: 67 },
    });
    const ONE = JSON.stringify({
      name: "MiliD High Protein Flour",
      basis: "per_100g",
      nutrients: { ENERC_KCAL: 350 },
    });
    mockProvider((model, prompt) => {
      if (prompt.includes("misses printed nutrients")) return reply(ONE);
      return reply(TWO);
    });

    const result = await extractFoodFromText(DESCRIPTION);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(3);
    expect(result.nutrients?.ENERC_KCAL).toBe(344.63);
  });

  it("keeps the first answer when the fallback also returns nothing usable", async () => {
    mockProvider(() => reply(WEAK));

    const result = await extractFoodFromText(DESCRIPTION);

    expect(result.name).toBe("MiliD High Protein Flour");
    expect(result.nutrients).toBeUndefined();
    expect(adapters.gemini.complete).toHaveBeenCalledTimes(3);
  });

  it("never re-asks a strong read even if partial", async () => {
    const TWO_PLUS = JSON.stringify({
      name: "MiliD High Protein Flour",
      basis: "per_100g",
      nutrients: { ENERC_KCAL: 344.63, PROCNT: 67, FIBTG: 8.83, NA: 355.8 },
    });
    mockProvider(() => reply(TWO_PLUS));

    const result = await extractFoodFromText(DESCRIPTION);

    expect(adapters.gemini.complete).toHaveBeenCalledTimes(1);
    expect(result.nutrients?.FIBTG).toBe(8.83);
  });
});
