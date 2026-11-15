import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let dbMod: typeof import("@/lib/db/client");
let foods: typeof import("@/lib/db/foods");
let captured: typeof import("@/lib/captured-food");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-foods-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  dbMod = await import("@/lib/db/client");
  foods = await import("@/lib/db/foods");
  captured = await import("@/lib/captured-food");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  dbMod.db.exec("DELETE FROM captured_food_portions; DELETE FROM captured_food_nutrients; DELETE FROM captured_foods;");
});

describe("captured foods round trip", () => {
  it("saves and reloads a food with nutrients and portions", () => {
    const prepared = captured.prepareCapturedFood({
      name: "Test Atta",
      aliases: ["atta"],
      category: "Grains",
      kind: "branded",
      state: "raw",
      nutrients: { ENERC_KCAL: 340, PROCNT: 13.2 },
      portions: [{ label: "1 roti", grams: 30 }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const saved = foods.saveCapturedFood(prepared.food);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const reloaded = foods.getCapturedFood(saved.food.id);
    expect(reloaded?.name).toBe("Test Atta");
    expect(reloaded?.nutrients.ENERC_KCAL.amount).toBe(340);
    expect(reloaded?.portions[0]?.grams).toBe(30);
  });

  it("blocks archival when the food is in use", () => {
    const prepared = captured.prepareCapturedFood({ name: "In use food" });
    if (!prepared.ok) throw new Error("prep failed");
    const saved = foods.saveCapturedFood(prepared.food);
    if (!saved.ok) throw new Error("save failed");

    // reference it from an entry row directly
    dbMod.db.prepare(
      `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("e1", saved.food.id, 100, 100, "g", "2026-01-01", new Date().toISOString());

    const result = foods.archiveCapturedFood(saved.food.id);
    expect(result.ok).toBe(false);
  });

  it("archives an unused food", () => {
    const prepared = captured.prepareCapturedFood({ name: "Unused food" });
    if (!prepared.ok) throw new Error("prep failed");
    const saved = foods.saveCapturedFood(prepared.food);
    if (!saved.ok) throw new Error("save failed");
    const result = foods.archiveCapturedFood(saved.food.id);
    expect(result.ok).toBe(true);
    expect(foods.getCapturedFood(saved.food.id)).toBeUndefined();
  });

  it("rejects a duplicate name unless allowed", () => {
    const a = captured.prepareCapturedFood({ name: "Dup" });
    if (!a.ok) throw new Error("prep");
    foods.saveCapturedFood(a.food);
    const b = captured.prepareCapturedFood({ name: "Dup" });
    if (!b.ok) throw new Error("prep");
    const result = foods.saveCapturedFood(b.food);
    expect(result.ok).toBe(false);
  });
});

describe("deleteCapturedFood", () => {
  it("deletes an unused food outright", () => {
    const prepared = captured.prepareCapturedFood({ name: "Delete me" });
    if (!prepared.ok) throw new Error("prep");
    const saved = foods.saveCapturedFood(prepared.food);
    if (!saved.ok) throw new Error("save");
    const result = foods.deleteCapturedFood(saved.food.id);
    if (!("outcome" in result)) throw new Error("expected ok delete");
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("deleted");
    expect(foods.getCapturedFood(saved.food.id)).toBeUndefined();
  });

  it("refuses to delete a food that is in use", () => {
    const prepared = captured.prepareCapturedFood({ name: "In use delete check" });
    if (!prepared.ok) throw new Error("prep");
    const saved = foods.saveCapturedFood(prepared.food);
    if (!saved.ok) throw new Error("save");
    dbMod.db.prepare(
      `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("del-e1", saved.food.id, 100, 100, "g", "2026-01-01", new Date().toISOString());
    const result = foods.deleteCapturedFood(saved.food.id);
    if (!("message" in result)) throw new Error("expected refusal");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/used in 1 place/);
    // the food still exists
    expect(foods.getCapturedFood(saved.food.id)).toBeDefined();
  });
});
