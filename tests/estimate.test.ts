import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CompleteFn } from "@/lib/ai/estimate";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let db: typeof import("@/lib/db/client")["db"];
let estimate: typeof import("@/lib/ai/estimate");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-estimate-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  ({ db } = await import("@/lib/db/client"));
  estimate = await import("@/lib/ai/estimate");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // clear cache between tests so "calls complete once" assertions hold
  db.exec("DELETE FROM estimate_cache");
});

const fakeComplete: CompleteFn = async (req) => {
  void req;
  return {
    text: JSON.stringify({
      factors: [
        { nutrient: "VITC", factor: 0.55, reason: "boiling destroys heat-labile vitamin C", confidence: "medium" },
        { nutrient: "NA", factor: 0.7, reason: "sodium leaches into discarded water", confidence: "low" },
        { nutrient: "NOPE", factor: 0.1, reason: "unknown code dropped", confidence: "low" },
      ],
      notes: "Water-soluble nutrients leach; drain and discard removes them.",
    }),
    latencyMs: 12,
  };
};

describe("estimateNodeDeltas", () => {
  it("parses factors, drops unknown codes, caches the result", async () => {
    let calls = 0;
    const countingComplete: CompleteFn = async (req) => {
      calls++;
      return fakeComplete(req);
    };
    const result = await estimate.estimateNodeDeltas(
      { operation: "boil", qualifier: "drained", inputs: [{ name: "tomato", grams: 100, kcalPer100g: 18 }] },
      countingComplete,
    );
    expect(result.factors.map((f) => f.nutrient)).toEqual(["VITC", "NA"]);
    expect(result.notes).toMatch(/leach/);

    // second call hits cache, no extra complete() calls
    const again = await estimate.estimateNodeDeltas(
      { operation: "boil", qualifier: "drained", inputs: [{ name: "tomato", grams: 100, kcalPer100g: 18 }] },
      countingComplete,
    );
    expect(again.factors.length).toBe(2);
    expect(calls).toBe(1);
  });

  it("parseEstimate throws when the model returns no JSON", () => {
    expect(() => estimate.parseEstimate("nope")).toThrow(/did not return JSON/);
  });

  it("clamps hallucinated factors and truncates free text", () => {
    const parsed = estimate.parseEstimate(
      JSON.stringify({
        factors: [
          { nutrient: "VITC", factor: 1e9, reason: "r".repeat(2_000), confidence: "high" },
          { nutrient: "NA", factor: -5, reason: "negative", confidence: "low" },
        ],
        notes: "n".repeat(5_000),
      }),
    );
    expect(parsed.factors.map((f) => f.factor)).toEqual([2, 0]);
    expect(parsed.factors[0].reason).toHaveLength(500);
    expect(parsed.notes).toHaveLength(2_000);
  });
});
