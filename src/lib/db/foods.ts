import { randomUUID } from "node:crypto";
import { db, transaction } from "./client";
import { defaultPersonId } from "./people";
import { SEED_FOODS, getSeedFood } from "@/lib/data/foods";
import { capturedFoodToFood, type PreparedCapturedFood } from "@/lib/captured-food";
import type { Food } from "@/lib/nutrition/types";

/**
 * The food registry.
 *
 * Two sources, one read API: the seed fixtures in `src/lib/data/foods.ts` and
 * everything the user captured, which lives here. A caller cannot tell them
 * apart and should not need to. When the importer (S1.5) lands, the seed rows
 * move into `captured_foods` with `source = 'seed'` and this file loses the
 * merge.
 */

interface CapturedRow {
  id: string;
  name: string;
  aliases: string;
  category: string | null;
  kind: string;
  state: string;
  density_g_ml: number | null;
  basis: string | null;
  serving_size_g: number | null;
  servings_per_pack: number | null;
  source: string;
  source_code: string | null;
  image_path: string | null;
  confidence: number | null;
  source_kind: string | null;
  source_published: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

interface NutrientRow {
  nutrient: string;
  amount: number | null;
  status: string;
  method: string | null;
  note: string | null;
}

interface PortionRow {
  label: string;
  grams: number;
  source: string | null;
}

function nutrientsFor(foodId: string): NutrientRow[] {
  return db
    .prepare(`SELECT nutrient, amount, status, method, note FROM captured_food_nutrients WHERE food_id = ?`)
    .all(foodId) as unknown as NutrientRow[];
}

function portionsFor(foodId: string): PortionRow[] {
  return db
    .prepare(
      `SELECT label, grams, source FROM captured_food_portions
       WHERE food_id = ? ORDER BY rowid ASC`,
    )
    .all(foodId) as unknown as PortionRow[];
}

function rowToFood(row: CapturedRow): Food {
  const prepared: PreparedCapturedFood & { id: string } = {
    id: row.id,
    name: row.name,
    aliases: JSON.parse(row.aliases) as string[],
    category: row.category ?? "Custom",
    kind: row.kind as PreparedCapturedFood["kind"],
    state: row.state as PreparedCapturedFood["state"],
    densityGPerMl: row.density_g_ml,
    basis: (row.basis as PreparedCapturedFood["basis"]) ?? null,
    servingSizeG: row.serving_size_g,
    servingsPerPack: row.servings_per_pack,
    source: row.source,
    sourceCode: row.source_code,
    sourceKind: row.source_kind,
    sourcePublished: row.source_published,
    imagePath: row.image_path,
    confidence: row.confidence,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    nutrients: nutrientsFor(row.id).map((entry) => ({
      nutrient: entry.nutrient as PreparedCapturedFood["nutrients"][number]["nutrient"],
      amount: entry.amount,
      status: entry.status as PreparedCapturedFood["nutrients"][number]["status"],
      method: entry.method,
      note: entry.note,
    })),
    portions: portionsFor(row.id).map((portion) => ({
      label: portion.label,
      grams: portion.grams,
      source: portion.source,
    })),
  };

  return capturedFoodToFood(prepared);
}

function capturedRows(): CapturedRow[] {
  return db
    .prepare(
      `SELECT * FROM captured_foods WHERE archived_at IS NULL
       ORDER BY name COLLATE NOCASE ASC`,
    )
    .all() as unknown as CapturedRow[];
}

/** Every food the app can use: seed first, then the user's, alphabetical. */
export function listFoods(): Food[] {
  return [...SEED_FOODS, ...capturedRows().map(rowToFood)];
}

/** Only the foods the user created. */
export function listCapturedFoods(): Food[] {
  return capturedRows().map(rowToFood);
}

export function getCapturedFood(id: string): Food | undefined {
  const row = db
    .prepare(`SELECT * FROM captured_foods WHERE id = ? AND archived_at IS NULL`)
    .get(id) as unknown as CapturedRow | undefined;
  return row ? rowToFood(row) : undefined;
}

export function getFood(id: string): Food | undefined {
  return getSeedFood(id) ?? getCapturedFood(id);
}

export function requireFood(id: string): Food {
  const food = getFood(id);
  if (!food) throw new Error(`Unknown food: ${id}`);
  return food;
}

export function findCapturedByName(name: string): Food | undefined {
  const normalised = name.trim().toLowerCase();
  return listCapturedFoods().find(
    (food) => food.name.trim().toLowerCase() === normalised,
  );
}

export type SaveCapturedResult =
  | { ok: true; food: Food }
  | { ok: false; message: string; duplicateOf?: string };

/** Create a captured food. The input is already validated and normalised. */
export function saveCapturedFood(
  prepared: PreparedCapturedFood,
  options: { id?: string; allowDuplicate?: boolean; createdBy?: string } = {},
): SaveCapturedResult {
  const duplicate = findCapturedByName(prepared.name);
  if (duplicate && !options.allowDuplicate) {
    return {
      ok: false,
      message: `You already have a food called "${duplicate.name}".`,
      duplicateOf: duplicate.id,
    };
  }

  const id = options.id ?? randomUUID();
  const createdAt = new Date().toISOString();
  // Provenance only: captures are shared library content, and this records
  // which person added it. It is never an authorization check.
  const createdBy = options.createdBy ?? defaultPersonId();

  transaction(() => {
    db.prepare(
      `INSERT INTO captured_foods
         (id, name, aliases, category, kind, state, density_g_ml, basis,
          serving_size_g, servings_per_pack, source, source_code, image_path,
          confidence, source_kind, source_published, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      prepared.name,
      JSON.stringify(prepared.aliases),
      prepared.category,
      prepared.kind,
      prepared.state,
      prepared.densityGPerMl,
      prepared.basis,
      prepared.servingSizeG,
      prepared.servingsPerPack,
      prepared.source,
      prepared.sourceCode,
      prepared.imagePath,
      prepared.confidence,
      prepared.sourceKind,
      prepared.sourcePublished,
      createdBy,
      createdAt,
    );

    const insertNutrient = db.prepare(
      `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status, method, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const nutrient of prepared.nutrients) {
      insertNutrient.run(id, nutrient.nutrient, nutrient.amount, nutrient.status, nutrient.method ?? null, nutrient.note ?? null);
    }

    const insertPortion = db.prepare(
      `INSERT INTO captured_food_portions (id, food_id, label, grams, source)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const portion of prepared.portions) {
      insertPortion.run(randomUUID(), id, portion.label, portion.grams, portion.source);
    }
  });

  const saved = getCapturedFood(id);
  if (!saved) return { ok: false, message: "The food could not be saved." };
  return { ok: true, food: saved };
}

/** Change the editable fields. Nutrients and portions are replaced wholesale. */
export function updateCapturedFood(
  id: string,
  prepared: PreparedCapturedFood,
): SaveCapturedResult {
  const existing = db
    .prepare(`SELECT id, created_at FROM captured_foods WHERE id = ? AND archived_at IS NULL`)
    .get(id) as unknown as { id: string; created_at: string } | undefined;
  if (!existing) return { ok: false, message: "That food no longer exists." };

  const duplicate = findCapturedByName(prepared.name);
  if (duplicate && duplicate.id !== id) {
    return {
      ok: false,
      message: `You already have a food called "${duplicate.name}".`,
      duplicateOf: duplicate.id,
    };
  }

  transaction(() => {
    db.prepare(
      `UPDATE captured_foods SET
         name = ?, aliases = ?, category = ?, kind = ?, state = ?, density_g_ml = ?,
         basis = ?, serving_size_g = ?, servings_per_pack = ?, source = ?,
         source_code = ?, image_path = ?, confidence = ?,
         source_kind = ?, source_published = ?
       WHERE id = ?`,
    ).run(
      prepared.name,
      JSON.stringify(prepared.aliases),
      prepared.category,
      prepared.kind,
      prepared.state,
      prepared.densityGPerMl,
      prepared.basis,
      prepared.servingSizeG,
      prepared.servingsPerPack,
      prepared.source,
      prepared.sourceCode,
      prepared.imagePath,
      prepared.confidence,
      prepared.sourceKind,
      prepared.sourcePublished,
      id,
    );

    db.prepare(`DELETE FROM captured_food_nutrients WHERE food_id = ?`).run(id);
    const insertNutrient = db.prepare(
      `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status, method, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const nutrient of prepared.nutrients) {
      insertNutrient.run(id, nutrient.nutrient, nutrient.amount, nutrient.status, nutrient.method ?? null, nutrient.note ?? null);
    }

    db.prepare(`DELETE FROM captured_food_portions WHERE food_id = ?`).run(id);
    const insertPortion = db.prepare(
      `INSERT INTO captured_food_portions (id, food_id, label, grams, source)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const portion of prepared.portions) {
      insertPortion.run(randomUUID(), id, portion.label, portion.grams, portion.source);
    }
  });

  const saved = getCapturedFood(id);
  if (!saved) return { ok: false, message: "The food could not be updated." };
  return { ok: true, food: saved };
}

/** How many places reference a food. Anything above zero blocks archival. */
export function countFoodReferences(id: string): number {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM entries WHERE food_id = ?) +
         (SELECT COUNT(*) FROM component_inputs WHERE food_id = ?) +
         (SELECT COUNT(*) FROM plan_entries WHERE food_id = ?) AS n`,
    )
    .get(id, id, id) as unknown as { n: number };
  return row.n;
}

/**
 * Archive, never delete. A food referenced by an entry, a recipe line or a
 * plan cannot be archived, because history would lose its target.
 */
export function archiveCapturedFood(id: string): { ok: boolean; message?: string } {
  const existing = getCapturedFood(id);
  if (!existing) return { ok: false, message: "That food no longer exists." };

  const references = countFoodReferences(id);
  if (references > 0) {
    return {
      ok: false,
      message: `It is used in ${references} place${references === 1 ? "" : "s"}. Remove those first.`,
    };
  }

  db.prepare(`UPDATE captured_foods SET archived_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
  return { ok: true };
}

export type DeleteCapturedFoodResult =
  | { ok: true; outcome: "deleted" | "archived" }
  | { ok: false; message: string };

/**
 * Delete a captured food outright when nothing references it, otherwise
 * archive it (history keeps its target). Foods referenced by entries,
 * recipes or plans cannot be destroyed.
 */
export function deleteCapturedFood(id: string): DeleteCapturedFoodResult {
  const existing = getCapturedFood(id);
  if (!existing) return { ok: false, message: "That food no longer exists." };

  const references = countFoodReferences(id);
  if (references > 0) {
    return {
      ok: false,
      message: `It is used in ${references} place${references === 1 ? "" : "s"}. Remove those entries, then delete.`,
    };
  }

  transaction(() => {
    db.prepare(`DELETE FROM captured_food_portions WHERE food_id = ?`).run(id);
    db.prepare(`DELETE FROM captured_food_nutrients WHERE food_id = ?`).run(id);
    db.prepare(`DELETE FROM captured_foods WHERE id = ?`).run(id);
  });
  return { ok: true, outcome: "deleted" };
}

/**
 * Fill nutrients that are currently unknown (amount NULL) on a captured food
 * with AI-estimated values. Known values are never overwritten, and every
 * fill is tagged estimated + ai:<model> with the model's own reason.
 */
export function fillEstimatedCapturedFood(
  foodId: string,
  fills: Array<{
    code: string;
    amount: number;
    confidence: "low" | "medium" | "high";
    reason: string;
    model: string;
  }>,
): { filled: number } {
  let filled = 0;
  transaction(() => {
    const stmt = db.prepare(
      `UPDATE captured_food_nutrients
         SET amount = ?, status = 'estimated', method = ?, note = ?
       WHERE food_id = ? AND nutrient = ? AND amount IS NULL`,
    );
    for (const fill of fills) {
      const note = fill.reason ? `[${fill.confidence}] ${fill.reason}` : `[${fill.confidence}]`;
      const result = stmt.run(fill.amount, `ai:${fill.model}`, note, foodId, fill.code);
      filled += Number(result.changes ?? 0);
    }
  });
  return { filled };
}
