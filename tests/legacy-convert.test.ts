import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Convert-all (S10).
 *
 * The promise is narrow and worth pinning down: conversion creates a new
 * v2 version, leaves the legacy version untouched, and does not move a plan
 * that was pinned to it (D-045). Running it twice must be a no-op rather
 * than a second conversion.
 */

let dir: string;
let db: typeof import("@/lib/db/client")["db"];
let convert: typeof import("@/lib/legacy-convert");
let getVersion: typeof import("@/lib/db/recipes")["getVersion"];

const NOW = "2026-11-18T09:00:00.000Z";

function insertLegacyRecipe(options: {
  recipeId: string;
  versionId: string;
  name: string;
}): void {
  const { recipeId, versionId, name } = options;
  db.prepare(
    `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
     VALUES (?, 'dish', ?, ?, ?, ?)`,
  ).run(recipeId, name, versionId, NOW, NOW);
  db.prepare(
    `INSERT INTO recipe_versions (id, recipe_id, version_no, instructions, servings, yield_g,
       snapshot, calculation_version, label, created_at)
     VALUES (?, ?, 1, 'Boil, then temper.', 2, 400, '{}', '1', 'legacy', ?)`,
  ).run(versionId, recipeId, NOW);
  db.prepare(
    `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
     VALUES (?, ?, 0, 'Base', 'boil', 400)`,
  ).run(`${versionId}-c0`, versionId);
  db.prepare(
    `INSERT INTO component_inputs (id, component_id, position, food_id, grams, amount, unit)
     VALUES (?, ?, 0, 'paneer', 200, 200, 'g')`,
  ).run(`${versionId}-i0`, `${versionId}-c0`);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-legacy-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);

  ({ db } = await import("@/lib/db/client"));
  convert = await import("@/lib/legacy-convert");
  ({ getVersion } = await import("@/lib/db/recipes"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("isLegacySnapshot", () => {
  it("treats an explicit v1 snapshot and unparseable JSON as legacy", () => {
    expect(convert.isLegacySnapshot(JSON.stringify({ calculationVersion: "1" }))).toBe(true);
    expect(convert.isLegacySnapshot("{not json")).toBe(true);
  });

  it("treats a v2 snapshot as current", () => {
    expect(convert.isLegacySnapshot(JSON.stringify({ calculationVersion: "2" }))).toBe(false);
  });
});

describe("convertAllLegacyRecipes", () => {
  it("creates a v2 version and leaves the legacy version in place", () => {
    insertLegacyRecipe({ recipeId: "r-legacy", versionId: "v-legacy", name: "Legacy dal" });

    const result = convert.convertAllLegacyRecipes();
    expect(result).toEqual({ converted: 1, skipped: 0, errors: [] });

    const legacy = getVersion("v-legacy");
    expect(legacy?.calculationVersion).toBe("1");
    expect(legacy?.blocks).toHaveLength(1);

    const row = db
      .prepare(
        `SELECT id, calculation_version, snapshot FROM recipe_versions
         WHERE recipe_id = ? ORDER BY version_no DESC LIMIT 1`,
      )
      .get("r-legacy") as unknown as { id: string; calculation_version: string; snapshot: string };

    expect(row.id).not.toBe("v-legacy");
    expect(row.calculation_version).toBe("2");
    const snapshot = JSON.parse(row.snapshot) as { graph?: { nodes: unknown[]; edges: unknown[] } };
    expect(snapshot.graph?.nodes.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.graph?.edges.length).toBeGreaterThanOrEqual(1);

    const recipe = db
      .prepare(`SELECT current_version_id FROM recipes WHERE id = ?`)
      .get("r-legacy") as unknown as { current_version_id: string };
    expect(recipe.current_version_id).toBe(row.id);
  });

  it("keeps a plan pinned to the legacy version on that version", () => {
    db.prepare(`INSERT INTO plans (id, starts_on, created_at) VALUES ('p-legacy', '2026-11-16', ?)`).run(NOW);
    db.prepare(
      `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
       VALUES ('pe-legacy', 'p-legacy', '2026-11-16', 'lunch', 0, 'v-legacy', 1, ?)`,
    ).run(NOW);

    convert.convertAllLegacyRecipes();

    const entry = db
      .prepare(`SELECT recipe_version_id FROM plan_entries WHERE id = 'pe-legacy'`)
      .get() as unknown as { recipe_version_id: string };
    expect(entry.recipe_version_id).toBe("v-legacy");
    expect(getVersion("v-legacy")?.calculationVersion).toBe("1");
  });

  it("is a no-op the second time", () => {
    const result = convert.convertAllLegacyRecipes();
    expect(result.converted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("reports nothing to convert for a recipe without a current version", () => {
    db.prepare(
      `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
       VALUES ('r-empty', 'dish', 'Draft', NULL, ?, ?)`,
    ).run(NOW, NOW);

    const result = convert.convertAllLegacyRecipes();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.errors).toEqual([]);
  });
});
