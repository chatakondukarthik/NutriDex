import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Food } from "@/lib/nutrition/types";
import type { RecipePlan } from "@/lib/ai-generate-recipe";
import type { UsdaStubs } from "@/lib/ai/food-resolve";

// The resolver module pulls in the database at import time, so the database
// path MUST be pointed at a throwaway file before any of these are loaded.
let matchLocalFood: typeof import("@/lib/ai/food-resolve")["matchLocalFood"];
let planUniqueFoodNames: typeof import("@/lib/ai/food-resolve")["planUniqueFoodNames"];
let resolvePlanFoods: typeof import("@/lib/ai/food-resolve")["resolvePlanFoods"];
let scoreName: typeof import("@/lib/ai/food-resolve")["scoreName"];

let dir: string;

const food = (id: string, name: string, aliases: string[] = []): Food =>
  ({ id, name, aliases }) as unknown as Food;

const PANEER = food("f-paneer", "Paneer", ["cottage cheese", "panir", "chhena"]);
const ONION = food("f-onion", "Onion");
const THIGH = food("f-thigh", "Chicken, thigh, boneless, raw");
const MRICE = food("f-rice", "Rice, raw milled", ["chawal"]);

function plan(inputs: string[]): RecipePlan {
  return {
    name: "Test dish",
    servings: 2,
    instructions: "",
    steps: [
      {
        name: "Prep",
        operation: "prep",
        inputs: inputs.map((foodName) => ({ foodName, grams: 100 })),
      },
    ],
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-resolve-import-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "import.sqlite"));
  ({ matchLocalFood, planUniqueFoodNames, resolvePlanFoods, scoreName } = await import(
    "@/lib/ai/food-resolve"
  ));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function usdaStub(hits: Array<{ fdcId: number; name: string }> | "throw"): UsdaStubs {
  return {
    search: async () => {
      if (hits === "throw") throw new Error("network down");
      return hits.map((h) => ({
        fdcId: h.fdcId,
        name: h.name,
        nutrients: { ENERC_KCAL: 150, PROCNT: 20 },
      }));
    },
    get: async (fdcId: number) =>
      hits === "throw"
        ? null
        : (() => {
            const hit = hits.find((h) => h.fdcId === fdcId);
            return hit ? { ...hit, nutrients: { ENERC_KCAL: 150, PROCNT: 20 } } : null;
          })(),
  };
}

describe("scoreName", () => {
  it("scores full coverage at 1 regardless of punctuation and case", () => {
    expect(scoreName("PANEER", "Paneer")).toBe(1);
    expect(scoreName("chicken, thigh", "Chicken thigh")).toBe(1);
  });

  it("scores partial coverage proportionally", () => {
    expect(scoreName("boneless chicken thigh", "chicken thigh")).toBe(1); // boneless is a stopword
    expect(scoreName("chicken quinoa", "chicken")).toBe(0.5);
  });
});

describe("matchLocalFood", () => {
  const foods = [PANEER, ONION, THIGH, MRICE];

  it("matches exact names case-insensitively, ignoring surrounding space", () => {
    expect(matchLocalFood("  paneer ", foods)?.food.id).toBe("f-paneer");
    expect(matchLocalFood("ONION", foods)?.food.id).toBe("f-onion");
  });

  it("matches aliases", () => {
    expect(matchLocalFood("dahi", [food("f-curd", "Curd", ["dahi", "yogurt"])])?.food.id).toBe("f-curd");
    expect(matchLocalFood("chhena", foods)?.food.id).toBe("f-paneer");
  });

  it("matches planned names to structured names by token coverage", () => {
    expect(matchLocalFood("boneless chicken thigh", foods)?.food.id).toBe("f-thigh");
    expect(matchLocalFood("raw milled rice", foods)?.food.id).toBe("f-rice");
  });

  it("rejects matches below the coverage threshold", () => {
    expect(matchLocalFood("quinoa", foods)).toBeNull();
    expect(matchLocalFood("chicken quinoa salmon", foods)).toBeNull();
  });
});

describe("planUniqueFoodNames", () => {
  it("deduplicates case-insensitively, preserving order", () => {
    const p = plan(["Paneer", "paneer", "Onion", " PANEER ", "onion"]);
    expect(planUniqueFoodNames(p)).toEqual(["Paneer", "Onion"]);
  });
});

describe("resolvePlanFoods (persist: false — preview)", () => {
  const foods = [PANEER, ONION, THIGH, MRICE];

  it("reuses local foods without calling USDA at all", async () => {
    let searches = 0;
    const stub: UsdaStubs = {
      search: async () => {
        searches += 1;
        return [];
      },
      get: async () => null,
    };

    const result = await resolvePlanFoods(plan(["paneer", "Onion"]), foods, {
      persist: false,
      usda: stub,
    });

    expect(result.resolutions.map((r) => [r.name, r.status])).toEqual([
      ["paneer", "reused"],
      ["Onion", "reused"],
    ]);
    expect(searches).toBe(0);
  });

  it("reports a USDA import for a miss with a confident USDA hit", async () => {
    // no chicken in the local fixtures for this one
    const withoutChicken = [PANEER, ONION, MRICE];
    const result = await resolvePlanFoods(plan(["chicken breast"]), withoutChicken, {
      persist: false,
      usda: usdaStub([{ fdcId: 171077, name: "Chicken, broilers or fryers, breast, meat only, raw" }]),
    });

    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).toMatchObject({
      status: "usda-import",
      fdcId: 171077,
      foodId: null, // nothing written at preview time
    });
  });

  it("falls back to provisional when USDA finds nothing and when USDA is down", async () => {
    const empty = await resolvePlanFoods(plan(["drumstick leaves"]), foods, {
      persist: false,
      usda: usdaStub([]),
    });
    expect(empty.resolutions[0].status).toBe("provisional");

    const down = await resolvePlanFoods(plan(["drumstick leaves"]), foods, {
      persist: false,
      usda: usdaStub("throw"),
    });
    expect(down.resolutions[0].status).toBe("provisional");
  });

  it("reuses a local food when only one token matches — reuse beats provisional", async () => {
    const result = await resolvePlanFoods(plan(["chicken breast"]), foods, {
      persist: false,
      usda: usdaStub([{ fdcId: 171077, name: "Chicken breast raw" }]),
    });
    expect(result.resolutions[0].status).toBe("reused");
    expect(result.resolutions[0].matchedName).toContain("Chicken");
  });

  it("handles singular/plural forms on both sides of the match", () => {
    expect(matchLocalFood("chicken fillets", [THIGH])?.food.id).toBe("f-thigh");
    expect(matchLocalFood("boneless chicken thighs", [THIGH])?.food.id).toBe("f-thigh");
    expect(matchLocalFood("basmati rice", [MRICE])?.food.id).toBe("f-rice");
    expect(matchLocalFood("garlic cloves", [food("f-garlic", "Garlic")])?.food.id).toBe("f-garlic");
    expect(matchLocalFood("tomatoes", [food("f-tomato", "Tomato")])?.food.id).toBe("f-tomato");
  });

  it("does not write anything in preview mode", async () => {
    const withoutChicken = [PANEER, ONION, MRICE];
    const result = await resolvePlanFoods(plan(["chicken breast"]), withoutChicken, {
      persist: false,
      usda: usdaStub([{ fdcId: 171077, name: "Chicken breast raw" }]),
    });
    expect(result.map.get("chicken breast")).toBeNull();
  });
});

describe("resolvePlanFoods (persist: true — confirm)", () => {
  let listFoods: typeof import("@/lib/db/foods")["listFoods"];
  let getFood: typeof import("@/lib/db/foods")["getFood"];

  beforeAll(async () => {
    ({ listFoods, getFood } = await import("@/lib/db/foods"));
  });

  it("creates a USDA-sourced captured food and reuses it on the next resolution", async () => {
    const dish = plan(["chicken thigh indian"]);
    const stub = usdaStub([{ fdcId: 171111, name: "Chicken, thigh, meat only, raw" }]);

    const first = await resolvePlanFoods(dish, listFoods(), { persist: true, usda: stub });
    expect(first.resolutions[0].status).toBe("usda-import");
    const savedId = first.map.get("chicken thigh indian");
    expect(savedId).toBeTruthy();

    const saved = getFood(savedId!);
    expect(saved?.source).toBe("usda");

    // second time, the local database has it — USDA is never consulted
    let searches = 0;
    const counting: UsdaStubs = {
      search: async () => {
        searches += 1;
        return [];
      },
      get: async () => null,
    };
    const second = await resolvePlanFoods(dish, listFoods(), { persist: true, usda: counting });
    expect(second.resolutions[0].status).toBe("reused");
    expect(searches).toBe(0);
    expect(second.map.get("chicken thigh indian")).toBe(savedId);
  });

  it("creates a provisional food when nothing has an answer", async () => {
    const dish = plan(["murgh malai leaves xyzzy"]);
    const result = await resolvePlanFoods(dish, listFoods(), { persist: true, usda: usdaStub([]) });

    expect(result.resolutions[0].status).toBe("provisional");
    const id = result.map.get("murgh malai leaves xyzzy");
    expect(id).toBeTruthy();
    expect(getFood(id!)?.source).toBe("ai-generated");
  });

  it("reuses manual/captured foods exactly, so hand-made records are used first", async () => {
    // the seed "Paneer" is already in listFoods; a fuzzy-miss name still matches by tokens
    const result = await resolvePlanFoods(plan(["fresh paneer"]), listFoods(), {
      persist: false,
      usda: false,
    });
    expect(result.resolutions[0].status).toBe("reused");
  });
});
