import { randomUUID } from "node:crypto";
import { db, transaction } from "./client";
import type { RecipeResult } from "@/lib/nutrition/recipe";
import type { PlanRecipeOption } from "@/lib/plan";

export interface StoredInput {
  id: string;
  foodId: string;
  /** Resolved weight. Stored, so the version does not move if a portion table changes. */
  grams: number;
  amount: number;
  unit: string;
  preparation: string | null;
  note: string | null;
}

export interface StoredBlock {
  id: string;
  name: string;
  operation: string | null;
  outputGrams: number | null;
  inputs: StoredInput[];
}

export interface RecipeSummary {
  id: string;
  name: string;
  kind: "dish" | "component";
  versionCount: number;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  currentVersionLabel: string | null;
  servings: number | null;
  kcalPerServing: number | null;
  updatedAt: string;
}

export interface RecipeVersionDetail {
  id: string;
  recipeId: string;
  recipeName: string;
  kind: "dish" | "component";
  versionNo: number;
  /** Optional human name for this version, e.g. "less salt". */
  label: string | null;
  instructions: string;
  servings: number;
  yieldGrams: number | null;
  snapshot: RecipeResult;
  calculationVersion: string;
  createdAt: string;
  blocks: StoredBlock[];
}

export interface VersionRef {
  id: string;
  versionNo: number;
  label: string | null;
  createdAt: string;
  servings: number;
  kcalPerServing: number | null;
  isCurrent: boolean;
}

export interface VersionInput {
  /** Optional human name for the version, not the recipe. */
  label?: string | null;
  instructions: string;
  servings: number;
  yieldGrams: number | null;
  blocks: Array<{
    name: string;
    operation: string | null;
    outputGrams: number | null;
    inputs: Array<{
      foodId: string;
      grams: number;
      amount: number;
      unit: string;
      preparation: string | null;
      note: string | null;
    }>;
  }>;
  snapshot: RecipeResult;
}

interface RecipeRow {
  id: string;
  kind: string;
  name: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  recipe_id: string;
  version_no: number;
  instructions: string;
  servings: number;
  yield_g: number | null;
  snapshot: string;
  calculation_version: string;
  label: string | null;
  created_at: string;
}

interface BlockRow {
  id: string;
  name: string;
  operation: string | null;
  output_g: number | null;
}

interface InputRow {
  id: string;
  component_id: string;
  food_id: string;
  grams: number;
  amount: number;
  unit: string;
  preparation: string | null;
  note: string | null;
}

function parseSnapshot(json: string): RecipeResult {
  return JSON.parse(json) as RecipeResult;
}

function kcalPerServing(snapshot: RecipeResult): number | null {
  return snapshot.perServing.totals.ENERC_KCAL;
}

/**
 * Create a recipe and its first version in one transaction.
 *
 * The name lives on the recipe; everything the user can change lives on
 * the version. That split is what makes "edit" produce a new version
 * instead of rewriting history (D-018, D-024).
 */
export function createRecipe(
  meta: { name: string; kind?: "dish" | "component" },
  version: VersionInput,
): { recipeId: string; versionId: string; versionNo: number } {
  return transaction(() => {
    const recipeId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(recipeId, meta.kind ?? "dish", meta.name, now, now);

    const inserted = insertVersion(recipeId, version);

    db.prepare("UPDATE recipes SET current_version_id = ?, updated_at = ? WHERE id = ?").run(
      inserted.versionId,
      now,
      recipeId,
    );

    return { recipeId, ...inserted };
  });
}

/** Save the current state as a new immutable version. */
export function addVersion(
  recipeId: string,
  version: VersionInput,
  name?: string,
): { recipeId: string; versionId: string; versionNo: number } {
  return transaction(() => {
    const exists = db.prepare("SELECT id FROM recipes WHERE id = ?").get(recipeId);
    if (!exists) throw new Error(`Unknown recipe: ${recipeId}`);

    const inserted = insertVersion(recipeId, version);

    db.prepare(
      "UPDATE recipes SET current_version_id = ?, updated_at = ?, name = COALESCE(?, name) WHERE id = ?",
    ).run(inserted.versionId, new Date().toISOString(), name ?? null, recipeId);

    return { recipeId, ...inserted };
  });
}

function insertVersion(
  recipeId: string,
  version: VersionInput,
): { versionId: string; versionNo: number } {
  const previous = db
    .prepare("SELECT MAX(version_no) AS max FROM recipe_versions WHERE recipe_id = ?")
    .get(recipeId) as unknown as { max: number | null };

  const versionNo = (previous?.max ?? 0) + 1;
  const versionId = randomUUID();

  db.prepare(
    `INSERT INTO recipe_versions
       (id, recipe_id, version_no, instructions, servings, yield_g, snapshot, calculation_version, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versionId,
    recipeId,
    versionNo,
    version.instructions,
    version.servings,
    version.yieldGrams,
    JSON.stringify(version.snapshot),
    version.snapshot.calculationVersion,
    version.label?.trim() || null,
    new Date().toISOString(),
  );

  version.blocks.forEach((block, blockIndex) => {
    const blockId = randomUUID();
    db.prepare(
      `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(blockId, versionId, blockIndex, block.name, block.operation, block.outputGrams);

    block.inputs.forEach((input, inputIndex) => {
      db.prepare(
        `INSERT INTO component_inputs
           (id, component_id, position, food_id, grams, amount, unit, preparation, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        blockId,
        inputIndex,
        input.foodId,
        input.grams,
        input.amount,
        input.unit,
        input.preparation,
        input.note,
      );
    });
  });

  return { versionId, versionNo };
}

export function listRecipes(): RecipeSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.name, r.current_version_id, r.created_at, r.updated_at,
              (SELECT COUNT(*) FROM recipe_versions v WHERE v.recipe_id = r.id) AS version_count,
              v.version_no, v.label, v.servings, v.snapshot
       FROM recipes r
       LEFT JOIN recipe_versions v ON v.id = r.current_version_id
       WHERE r.archived_at IS NULL
       ORDER BY r.updated_at DESC, r.rowid DESC`,
    )
    .all() as unknown as Array<
    RecipeRow & {
      version_count: number;
      version_no: number | null;
      label: string | null;
      servings: number | null;
      snapshot: string | null;
    }
  >;

  return rows.map((row) => {
    const snapshot = row.snapshot ? parseSnapshot(row.snapshot) : null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === "component" ? "component" : "dish",
      versionCount: row.version_count,
      currentVersionId: row.current_version_id,
      currentVersionNo: row.version_no,
      currentVersionLabel: row.label,
      servings: row.servings,
      kcalPerServing: snapshot ? kcalPerServing(snapshot) : null,
      updatedAt: row.updated_at,
    };
  });
}

export function getRecipe(
  recipeId: string,
): { summary: RecipeSummary; versions: VersionRef[] } | undefined {
  const summary = listRecipes().find((recipe) => recipe.id === recipeId);
  if (!summary) return undefined;

  const rows = db
    .prepare(
      `SELECT id, version_no, label, created_at, servings, snapshot
       FROM recipe_versions WHERE recipe_id = ? ORDER BY version_no DESC`,
    )
    .all(recipeId) as unknown as Array<
    Pick<VersionRow, "id" | "version_no" | "label" | "created_at" | "servings" | "snapshot">
  >;

  const versions: VersionRef[] = rows.map((row) => ({
    id: row.id,
    versionNo: row.version_no,
    label: row.label,
    createdAt: row.created_at,
    servings: row.servings,
    kcalPerServing: kcalPerServing(parseSnapshot(row.snapshot)),
    isCurrent: row.id === summary.currentVersionId,
  }));

  return { summary, versions };
}

export function getVersion(versionId: string): RecipeVersionDetail | undefined {
  const version = db
    .prepare(
      `SELECT v.*, r.name AS recipe_name, r.kind AS recipe_kind
       FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id
       WHERE v.id = ?`,
    )
    .get(versionId) as unknown as (VersionRow & { recipe_name: string; recipe_kind: string }) | undefined;

  if (!version) return undefined;

  const blockRows = db
    .prepare("SELECT id, name, operation, output_g FROM components WHERE recipe_version_id = ? ORDER BY position")
    .all(versionId) as unknown as BlockRow[];

  const inputRows = db
    .prepare(
      `SELECT ci.* FROM component_inputs ci
       JOIN components c ON c.id = ci.component_id
       WHERE c.recipe_version_id = ?
       ORDER BY c.position, ci.position`,
    )
    .all(versionId) as unknown as InputRow[];

  const inputsByBlock = new Map<string, StoredInput[]>();
  for (const input of inputRows) {
    const list = inputsByBlock.get(input.component_id) ?? [];
    list.push({
      id: input.id,
      foodId: input.food_id,
      grams: input.grams,
      amount: input.amount,
      unit: input.unit,
      preparation: input.preparation,
      note: input.note,
    });
    inputsByBlock.set(input.component_id, list);
  }

  return {
    id: version.id,
    recipeId: version.recipe_id,
    recipeName: version.recipe_name,
    kind: version.recipe_kind === "component" ? "component" : "dish",
    versionNo: version.version_no,
    label: version.label,
    instructions: version.instructions,
    servings: version.servings,
    yieldGrams: version.yield_g,
    snapshot: parseSnapshot(version.snapshot),
    calculationVersion: version.calculation_version,
    createdAt: version.created_at,
    blocks: blockRows.map((block) => ({
      id: block.id,
      name: block.name,
      operation: block.operation,
      outputGrams: block.output_g,
      inputs: inputsByBlock.get(block.id) ?? [],
    })),
  };
}

export function countRecipes(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recipes").get() as unknown as {
    count: number;
  };
  return row.count;
}

/**
 * Every recipe version, in the shape the plan needs.
 *
 * The plan pins a version, so the palette offers every version — not just
 * the current one — and each option carries that version's stored
 * snapshot. Editing a recipe later creates a new version and leaves a
 * planned week alone (D-024).
 */
export function listRecipeOptions(): PlanRecipeOption[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.current_version_id,
              v.id AS version_id, v.version_no, v.label, v.servings, v.snapshot
       FROM recipes r
       JOIN recipe_versions v ON v.recipe_id = r.id
       ORDER BY r.name COLLATE NOCASE ASC, v.version_no DESC`,
    )
    .all() as unknown as Array<{
    id: string;
    name: string;
    current_version_id: string | null;
    version_id: string;
    version_no: number;
    label: string | null;
    servings: number;
    snapshot: string;
  }>;

  return rows.map((row) => {
    const snapshot = parseSnapshot(row.snapshot);
    return {
      recipeId: row.id,
      name: row.name,
      versionId: row.version_id,
      versionNo: row.version_no,
      label: row.label,
      isCurrent: row.version_id === row.current_version_id,
      servings: row.servings,
      perServing: snapshot.perServing,
    };
  });
}

/**
 * Ingredient food ids per recipe, from its current version's blocks.
 *
 * Used by the recipes browser to filter by "recipes that use paneer".
 * One query, one row per recipe; callers join against listFoods() for names.
 */
export function listRecipeIngredientIds(): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT r.id AS recipe_id, GROUP_CONCAT(DISTINCT ci.food_id) AS ids
       FROM recipes r
       JOIN recipe_versions v ON v.id = r.current_version_id
       JOIN components c ON c.recipe_version_id = v.id
       JOIN component_inputs ci ON ci.component_id = c.id
       GROUP BY r.id`,
    )
    .all() as unknown as Array<{ recipe_id: string; ids: string | null }>;

  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.recipe_id, row.ids ? row.ids.split(",").filter(Boolean) : []);
  }
  return map;
}

/** References from plans or diary entries to any version of a recipe. */
export function countRecipeReferences(recipeId: string): number {
  const rows = db
    .prepare(`SELECT id FROM recipe_versions WHERE recipe_id = ?`)
    .all(recipeId) as unknown as Array<{ id: string }>;
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM plan_entries WHERE recipe_version_id IN (${placeholders})) +
         (SELECT COUNT(*) FROM entries WHERE recipe_version_id IN (${placeholders})) AS n`,
    )
    .get(...ids, ...ids) as unknown as { n: number };
  return row.n;
}

export type DeleteRecipeResult =
  | { ok: true; outcome: "deleted" | "archived" }
  | { ok: false; message: string };

/**
 * Delete a recipe, or archive it when something references it.
 * A recipe referenced by a plan or by a component inside another recipe
 * must keep its versions; it is hidden, never destroyed.
 */
export function deleteRecipe(recipeId: string): DeleteRecipeResult {
  const recipe = db.prepare(`SELECT id FROM recipes WHERE id = ?`).get(recipeId) as unknown as
    | { id: string }
    | undefined;
  if (!recipe) return { ok: false, message: "That recipe no longer exists." };

  const references = countRecipeReferences(recipeId);
  if (references > 0) {
    db.prepare(`UPDATE recipes SET archived_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      recipeId,
    );
    return { ok: true, outcome: "archived" };
  }

  transaction(() => {
    const versionIds = (
      db.prepare(`SELECT id FROM recipe_versions WHERE recipe_id = ?`).all(recipeId) as unknown as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    const componentIds = versionIds.length
      ? (
          db
            .prepare(
              `SELECT id FROM components WHERE recipe_version_id IN (${versionIds.map(() => "?").join(",")})`,
            )
            .all(...versionIds) as unknown as Array<{ id: string }>
        ).map((r) => r.id)
      : [];
    if (componentIds.length) {
      db.prepare(
        `DELETE FROM component_inputs WHERE component_id IN (${componentIds.map(() => "?").join(",")})`,
      ).run(...componentIds);
      db.prepare(`DELETE FROM components WHERE id IN (${componentIds.map(() => "?").join(",")})`).run(
        ...componentIds,
      );
    }
    if (versionIds.length) {
      db.prepare(`DELETE FROM recipe_versions WHERE id IN (${versionIds.map(() => "?").join(",")})`).run(
        ...versionIds,
      );
    }
    db.prepare(`DELETE FROM recipes WHERE id = ?`).run(recipeId);
  });
  return { ok: true, outcome: "deleted" };
}

/** Count of non-archived recipes whose current version uses calculation_version = '1' (legacy). */
export function countLegacyRecipes(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM recipes r
       JOIN recipe_versions v ON v.id = r.current_version_id
       WHERE r.archived_at IS NULL AND v.calculation_version = '1'`,
    )
    .get() as unknown as { n: number };
  return row.n;
}
