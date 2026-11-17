import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Server-action boundary.
 *
 * A server action is a public HTTP endpoint. These tests call the actions
 * directly with hostile input and assert two things: the rejection message is
 * specific, and nothing was written. The database is a throwaway file.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let actions: typeof import("@/app/actions");
let entries: typeof import("@/lib/db/entries");
let plan: typeof import("@/lib/db/plan");
let recipes: typeof import("@/lib/recipes");
let db: typeof import("@/lib/db/client")["db"];
let weekStart: typeof import("@/lib/plan")["weekStart"];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-actions-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  // Keep AI config and secrets out of the repo's real `data/` directory so a
  // developer's settings cannot change what these tests see.
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);
  actions = await import("@/app/actions");
  entries = await import("@/lib/db/entries");
  plan = await import("@/lib/db/plan");
  recipes = await import("@/lib/recipes");
  db = (await import("@/lib/db/client")).db;
  weekStart = (await import("@/lib/plan")).weekStart;
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM plan_entries; DELETE FROM plans; DELETE FROM entries;");
});

/** Every plan entry in a week, without assuming the plan already exists. */
function entriesInWeek(week: string) {
  const found = plan.getPlan(weekStart(week));
  return found ? plan.listPlanEntries(found.id) : [];
}

describe("addFoodAction", () => {
  it("stores the converted gram weight, not the raw amount", async () => {
    const result = await actions.addFoodAction({
      foodId: "paneer",
      amount: 1,
      unit: "portion",
      portionLabel: "1 katori",
    });

    expect(result.ok).toBe(true);
    const stored = entries.listEntries(entries.today());
    expect(stored).toHaveLength(1);
    expect(stored[0].grams).toBe(100);
  });

  it.each([
    [{ foodId: "not-a-food", amount: 1, unit: "g" }, /does not exist/i],
    [{ foodId: "paneer", amount: 1, unit: "cups" }, /unsupported unit/i],
    [{ foodId: "paneer", amount: 0, unit: "g" }, /positive number/i],
    [{ foodId: "paneer", amount: -1, unit: "g" }, /positive number/i],
    [{ foodId: "paneer", amount: 1e308, unit: "kg" }, /positive number|too large/i],
    [{ foodId: "paneer", amount: 1e9, unit: "g" }, /too large/i],
    [{ foodId: "paneer", amount: 1, unit: "portion", portionLabel: "1 bucket" }, /no portion/i],
  ])("rejects %j", async (input, message) => {
    const result = await actions.addFoodAction(input as Parameters<typeof actions.addFoodAction>[0]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(message);
    expect(entries.listEntries(entries.today())).toHaveLength(0);
  });
});

describe("removeEntryAction", () => {
  it("removes only the requested entry", async () => {
    const first = entries.addEntry({
      foodId: "paneer",
      grams: 100,
      amount: 1,
      unit: "g",
      day: entries.today(),
    });
    entries.addEntry({ foodId: "egg", grams: 50, amount: 1, unit: "g", day: entries.today() });

    await actions.removeEntryAction(first.id);

    const remaining = entries.listEntries(entries.today());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].foodId).toBe("egg");
  });
});

const WEEK = "2026-11-09"; // Monday
const DAY = "2026-11-11"; // Wednesday

describe("addRecipeEntryAction", () => {
  it("logs a pinned recipe version at the current servings", async () => {
    const saved = recipes.saveRecipeDraft({
      name: "Dal tadka",
      instructions: "",
      servings: 2,
      blocks: [{ inputs: [{ foodId: "toor-dal", amount: 200, unit: "g" }] }],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = await actions.addRecipeEntryAction({
      recipeVersionId: saved.versionId,
      servings: 1.5,
    });

    expect(result.ok).toBe(true);
    const rows = entries.listEntries(entries.today());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipeVersionId: saved.versionId,
      foodId: null,
      amount: 1.5,
      unit: "serving",
    });
    expect(rows[0].grams).toBeGreaterThan(0);
  });

  it.each([
    [{ recipeVersionId: "missing", servings: 1 }, /no longer exists/i],
    [{ recipeVersionId: "x", servings: 0 }, /no longer exists|positive number/i],
  ])("rejects %j", async (input, message) => {
    const result = await actions.addRecipeEntryAction(
      input as Parameters<typeof actions.addRecipeEntryAction>[0],
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(message);
  });
});

describe("addPlanEntryAction", () => {
  it("adds a food entry", async () => {
    const result = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "breakfast",
      foodId: "paneer",
      grams: 120,
    });

    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({ foodId: "paneer", grams: 120, slot: "breakfast" });
  });

  it("adds a pinned recipe version and scales by servings", async () => {
    const saved = recipes.saveRecipeDraft({
      name: "Paneer bhurji",
      instructions: "",
      servings: 2,
      blocks: [{ inputs: [{ foodId: "paneer", amount: 200, unit: "g" }] }],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      recipeVersionId: saved.versionId,
      servings: 1.5,
    });

    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({ recipeVersionId: saved.versionId, servings: 1.5 });
  });

  it.each([
    [{ week: "not-a-date", day: DAY, slot: "lunch", foodId: "paneer", grams: 100 }, /week/i],
    [{ week: WEEK, day: "2026-11-16", slot: "lunch", foodId: "paneer", grams: 100 }, /not in this week/i],
    [{ week: WEEK, day: "2026-02-30", slot: "lunch", foodId: "paneer", grams: 100 }, /not in this week/i],
    [{ week: WEEK, day: DAY, slot: "brunch", foodId: "paneer", grams: 100 }, /slot/i],
    [{ week: WEEK, day: DAY, slot: "lunch", grams: 100 }, /choose a food or a recipe/i],
    [
      { week: WEEK, day: DAY, slot: "lunch", foodId: "paneer", recipeVersionId: "x", grams: 100 },
      /choose a food or a recipe/i,
    ],
    [{ week: WEEK, day: DAY, slot: "lunch", foodId: "not-a-food", grams: 100 }, /does not exist/i],
    [{ week: WEEK, day: DAY, slot: "lunch", foodId: "paneer", grams: 0 }, /positive number/i],
    [{ week: WEEK, day: DAY, slot: "lunch", foodId: "paneer", grams: 1e9 }, /too large/i],
    [
      { week: WEEK, day: DAY, slot: "lunch", recipeVersionId: "missing", servings: 1 },
      /does not exist/i,
    ],
  ])("rejects %j", async (input, message) => {
    const result = await actions.addPlanEntryAction(
      input as Parameters<typeof actions.addPlanEntryAction>[0],
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(message);
  });

  it("rejects a non-positive serving count for a real version", async () => {
    const saved = recipes.saveRecipeDraft({
      name: "Paneer bhurji",
      instructions: "",
      servings: 2,
      blocks: [{ inputs: [{ foodId: "paneer", amount: 200, unit: "g" }] }],
    });
    if (!saved.ok) throw new Error("setup failed");

    const result = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      recipeVersionId: saved.versionId,
      servings: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/positive number/i);
  });

  it("does not create an empty plan row when the request is rejected", async () => {
    const before = entriesInWeek(WEEK).length;
    await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      foodId: "not-a-food",
      grams: 100,
    });
    expect(entriesInWeek(WEEK)).toHaveLength(before);
    expect(plan.getPlan(weekStart(WEEK))).toBeNull();
  });
});

describe("movePlanEntryAction", () => {
  it("moves an entry within the week", async () => {
    const added = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
    });
    expect(added.ok).toBe(true);
    if (!added.ok || !added.entry) return;

    const moved = await actions.movePlanEntryAction({
      week: WEEK,
      id: added.entry.id,
      day: "2026-11-13",
      slot: "dinner",
    });

    expect(moved.ok).toBe(true);
    const stored = entriesInWeek(WEEK).find((entry) => entry.id === added.entry!.id);
    expect(stored).toMatchObject({ day: "2026-11-13", slot: "dinner" });
  });

  it("refuses to move an entry outside the week", async () => {
    const added = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
    });
    if (!added.ok || !added.entry) throw new Error("setup failed");

    const moved = await actions.movePlanEntryAction({
      week: WEEK,
      id: added.entry.id,
      day: "2026-11-20",
      slot: "dinner",
    });

    expect(moved.ok).toBe(false);
    expect(moved.message).toMatch(/not in this week/i);
  });
});

describe("updatePlanEntryQuantityAction", () => {
  it("rejects a non-positive or oversized weight", async () => {
    const added = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
    });
    if (!added.ok || !added.entry) throw new Error("setup failed");

    expect((await actions.updatePlanEntryQuantityAction(added.entry.id, { grams: 0 })).ok).toBe(
      false,
    );
    expect((await actions.updatePlanEntryQuantityAction(added.entry.id, { grams: 1e9 })).ok).toBe(
      false,
    );
    expect((await actions.updatePlanEntryQuantityAction(added.entry.id, { grams: 150 })).ok).toBe(
      true,
    );
  });

  it("rejects an unknown or oversized unit string", async () => {
    const added = await actions.addPlanEntryAction({
      week: WEEK,
      day: DAY,
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
    });
    if (!added.ok || !added.entry) throw new Error("setup failed");

    expect(
      (await actions.updatePlanEntryQuantityAction(added.entry.id, { grams: 100, unit: "bogus" }))
        .ok,
    ).toBe(false);
    expect(
      (
        await actions.updatePlanEntryQuantityAction(added.entry.id, {
          grams: 100,
          unit: "g".repeat(65),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await actions.updatePlanEntryQuantityAction(added.entry.id, {
          grams: 100,
          unit: "portion:1 katori",
        })
      ).ok,
    ).toBe(true);
  });
});

describe("extractFoodAction image validation", () => {  it("rejects a file whose bytes do not match its declared type", async () => {
    const result = await actions.extractFoodAction({
      mode: "image",
      images: [
        {
          mimeType: "image/png",
          data: Buffer.from("not a png at all").toString("base64"),
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not the image type/);
  });

  it("rejects an unsupported declared type even when the bytes are an image", async () => {
    // A valid JPEG magic number, mislabelled as SVG.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]).toString("base64");
    const result = await actions.extractFoodAction({
      mode: "image",
      images: [{ mimeType: "image/svg+xml", data: jpeg }],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not supported/);
  });

  it("rejects data that is not base64", async () => {
    const result = await actions.extractFoodAction({
      mode: "image",
      images: [{ mimeType: "image/png", data: "<svg>not base64</svg>" }],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not valid base64/);
  });
});

describe("copyPlanDayAction", () => {
  const TARGET = "2026-11-12"; // Thursday of the same week

  function insertSourceEntry(id: string, position: number, grams: number | null) {
    const source = plan.getOrCreatePlan(weekStart(WEEK));
    db.prepare(
      `INSERT INTO plan_entries
         (id, plan_id, day, slot, position, food_id, grams, amount, unit, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, source.id, DAY, "lunch", position, "paneer", grams, 1, "g", new Date().toISOString());
  }

  it("copies every entry of the day", async () => {
    insertSourceEntry("copy-a", 0, 100);
    insertSourceEntry("copy-b", 1, 50);

    const result = await actions.copyPlanDayAction(DAY, TARGET);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(entriesInWeek(TARGET).filter((e) => e.day === TARGET)).toHaveLength(2);
  });

  it("rolls back the whole copy when one row fails", async () => {
    // A food entry with no grams is rejected by addPlanEntry. It is the
    // second row, so a non-transactional copy would leave the first behind.
    insertSourceEntry("copy-good", 0, 100);
    insertSourceEntry("copy-bad", 1, null);

    const result = await actions.copyPlanDayAction(DAY, TARGET);
    expect(result.ok).toBe(false);
    expect(entriesInWeek(TARGET).filter((e) => e.day === TARGET)).toHaveLength(0);
  });
});

describe("saveGraphAction caps", () => {
  const base = {
    name: "Test recipe",
    instructions: "",
    servings: 2,
    graph: { nodes: [], edges: [] },
  };

  function save(overrides: Record<string, unknown>) {
    return actions.saveGraphAction({ ...base, ...overrides } as never);
  }

  it("rejects too many nodes or edges", async () => {
    expect((await save({ graph: { nodes: new Array(301).fill({}), edges: [] } })).ok).toBe(false);
    expect((await save({ graph: { nodes: [], edges: new Array(601).fill({}) } })).ok).toBe(false);
  });

  it("rejects too many layout keys", async () => {
    const layout = Object.fromEntries(
      Array.from({ length: 601 }, (_, i) => [`n${i}`, { x: 0, y: 0 }]),
    );
    expect((await save({ layout })).ok).toBe(false);
  });

  it("rejects oversized names, labels and instructions", async () => {
    expect((await save({ name: "x".repeat(201) })).ok).toBe(false);
    expect((await save({ versionLabel: "x".repeat(121) })).ok).toBe(false);
    expect((await save({ instructions: "x".repeat(20_001) })).ok).toBe(false);
  });

  it("rejects an impossible serving count and an unknown save mode", async () => {
    expect((await save({ servings: 1_001 })).ok).toBe(false);
    expect((await save({ mode: "overwrite" })).ok).toBe(false);
  });
});
