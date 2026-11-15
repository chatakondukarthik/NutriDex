import { randomUUID } from "node:crypto";
import { db, transaction } from "./client";
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
  created_at: string;
  archived_at: string | null;
}

interface NutrientRow {
  nutrient: string;
  amount: number | null;
  status: string;
}

interface PortionRow {
  label: string;
  grams: number;
  source: string | null;
}

function nutrientsFor(foodId: string): NutrientRow[] {
  return db
    .prepare(`SELECT nutrient, amount, status FROM captured_food_nutrients WHERE food_id = ?`)
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
    imagePath: row.image_path,
    confidence: row.confidence,
    nutrients: nutrientsFor(row.id).map((entry) => ({
      nutrient: entry.nutrient as PreparedCapturedFood["nutrients"][number]["nutrient"],
      amount: entry.amount,
      status: entry.status as PreparedCapturedFood["nutrients"][number]["status"],
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
  options: { id?: string; allowDuplicate?: boolean } = {},
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

  transaction(() => {
    db.prepare(
      `INSERT INTO captured_foods
         (id, name, aliases, category, kind, state, density_g_ml, basis,
          serving_size_g, servings_per_pack, source, source_code, image_path,
          confidence, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?)`,
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
      createdAt,
    );

    const insertNutrient = db.prepare(
      `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status, method)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const nutrient of prepared.nutrients) {
      insertNutrient.run(id, nutrient.nutrient, nutrient.amount, nutrient.status, null);
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
         source_code = ?, image_path = ?, confidence = ?
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
      id,
    );

    db.prepare(`DELETE FROM captured_food_nutrients WHERE food_id = ?`).run(id);
    const insertNutrient = db.prepare(
      `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status, method)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const nutrient of prepared.nutrients) {
      insertNutrient.run(id, nutrient.nutrient, nutrient.amount, nutrient.status, null);
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
