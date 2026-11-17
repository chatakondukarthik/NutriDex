import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db, reseedRetentionFactors, transaction } from "./client";
import { dataFile } from "@/lib/data-dir";
import { IMPORTABLE_SETTINGS } from "@/lib/archive/registry";

/**
 * Deleting user data by category.
 *
 * Three rules shape this module:
 *
 *   1. **Nothing is implicit.** The caller names each category; a category
 *      deletes exactly the rows described in `PURGE_CATEGORIES`. Seed foods,
 *      seed retention factors, `meta` and the AI keys are never touched.
 *   2. **No dangling references.** A captured food is referenced by
 *      `entries.food_id`, `plan_entries.food_id` and `component_inputs.food_id`
 *      without a foreign key, and a recipe version is referenced by diary and
 *      plan rows with one. Deleting a parent while a child the user did not
 *      select still points at it would either fail the transaction or leave a
 *      row that renders as "unknown food". The purge refuses instead, and the
 *      preview names the categories that must be selected too.
 *   3. **Files follow rows.** Evidence images are removed only after the
 *      database transaction commits, so a rollback cannot leave rows pointing
 *      at deleted files. A failed unlink is reported, not hidden.
 *
 * The preview and the purge run the same dependency queries. The preview is
 * for the UI; the purge re-checks inside `BEGIN IMMEDIATE`, so a client cannot
 * bypass the check by sending a stale or hand-made selection.
 */

export const PURGE_CATEGORIES = [
  {
    id: "diary",
    label: "Diary entries",
    unit: "entry",
    description: "Every food and recipe you logged, across every day.",
  },
  {
    id: "plans",
    label: "Weekly plans",
    unit: "plan",
    description: "Plans and every meal placed in them.",
  },
  {
    id: "recipes",
    label: "Recipes",
    unit: "recipe",
    description: "Recipes, their versions, blocks and ingredient lines. Archived recipes are included.",
  },
  {
    id: "foods",
    label: "Foods you created",
    unit: "food",
    description: "Foods you added, their nutrients, portions and local evidence images, plus their pinned amounts. Foods that ship with the app are kept.",
  },
  {
    id: "defaults",
    label: "Saved default amounts",
    unit: "default",
    description: "Pinned amounts and units for foods, including foods that ship with the app.",
  },
  {
    id: "profile",
    label: "Profile",
    unit: "profile",
    description: "Body and goal inputs. Recommended targets fall back to the example profile.",
  },
  {
    id: "preferences",
    label: "Settings and overrides",
    unit: "setting",
    description: "AI instructions, nutrient status thresholds and cooking-retention overrides. Shipped defaults are restored. Provider, model and endpoint settings in AI access are managed separately, like keys.",
  },
  {
    id: "ai",
    label: "AI activity log",
    unit: "record",
    description: "The AI call log and cached nutrient estimates. Your saved AI keys are managed separately in AI access.",
  },
] as const;

export type PurgeCategoryId = (typeof PURGE_CATEGORIES)[number]["id"];

type PurgeCategorySpec = (typeof PURGE_CATEGORIES)[number];

const CATEGORY_BY_ID: ReadonlyMap<PurgeCategoryId, PurgeCategorySpec> = new Map(
  PURGE_CATEGORIES.map((spec) => [spec.id, spec]),
);

/** A category that must also be selected before the owner can be deleted. */
export interface PurgeBlocker {
  category: PurgeCategoryId;
  label: string;
  unit: string;
  count: number;
}

export interface PurgeCategoryPreview {
  id: PurgeCategoryId;
  label: string;
  unit: string;
  description: string;
  /** The category's primary rows, e.g. recipes, not their versions. */
  count: number;
  /** A short breakdown for the UI. */
  detail?: string;
  /** Categories that still reference this data. Empty for leaf categories. */
  blockers: PurgeBlocker[];
}

export interface PurgePreview {
  categories: PurgeCategoryPreview[];
}

export type PurgeResult =
  | {
      ok: true;
      deleted: Partial<Record<PurgeCategoryId, number>>;
      filesRemoved: number;
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      /** The selected categories that are still referenced. */
      blocked?: PurgeCategoryId[];
      blockers?: PurgeBlocker[];
    };

/** Thrown inside the transaction so `transaction()` rolls back the whole purge. */
class PurgeBlockedError extends Error {
  readonly owners: PurgeCategoryId[];
  readonly blockers: PurgeBlocker[];

  constructor(owners: PurgeCategoryId[], blockers: PurgeBlocker[]) {
    super("The selected data is still referenced by data that was not selected.");
    this.name = "PurgeBlockedError";
    this.owners = owners;
    this.blockers = blockers;
  }
}

function count(sql: string, ...params: Array<string | number | null>): number {
  const row = db.prepare(sql).get(...params) as unknown as { n: number } | undefined;
  return row?.n ?? 0;
}

function labelOf(id: PurgeCategoryId): string {
  return CATEGORY_BY_ID.get(id)?.label ?? id;
}

function unitOf(id: PurgeCategoryId): string {
  return CATEGORY_BY_ID.get(id)?.unit ?? "item";
}

/** Settings rows the archive can restore, and therefore the only ones a purge resets. */
function preferenceKeys(): string[] {
  return [...IMPORTABLE_SETTINGS].sort();
}

function preferenceSql(): { sql: string; keys: string[] } {
  const keys = preferenceKeys();
  return {
    sql: keys.map(() => "?").join(", "),
    keys,
  };
}

/**
 * Distinct recipes that reference a captured food.
 *
 * A connected v2 food node also becomes a `component_inputs` row, but an
 * unconnected node lives only in the version's snapshot JSON. Counting both
 * sources by recipe id keeps the blocker count in the same unit as its label
 * ("recipe") and catches a hand-orphaned node that would otherwise make the
 * saved graph fail with "Unknown food" after its food was deleted.
 */
function recipesReferencingCapturedFoods(): number {
  const recipeIds = new Set<string>();
  const connected = db
    .prepare(
      `SELECT DISTINCT rv.recipe_id AS id
       FROM component_inputs ci
       JOIN components c ON c.id = ci.component_id
       JOIN recipe_versions rv ON rv.id = c.recipe_version_id
       JOIN captured_foods f ON f.id = ci.food_id`,
    )
    .all() as unknown as Array<{ id: string }>;
  for (const row of connected) recipeIds.add(row.id);

  const captured = new Set(
    (db.prepare("SELECT id FROM captured_foods").all() as unknown as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  );
  if (captured.size === 0) return recipeIds.size;

  const snapshots = db
    .prepare("SELECT recipe_id, snapshot FROM recipe_versions")
    .all() as unknown as Array<{ recipe_id: string; snapshot: string }>;
  for (const row of snapshots) {
    try {
      const snapshot = JSON.parse(row.snapshot) as {
        graph?: { nodes?: Array<{ type?: string; foodId?: string }> };
      };
      const nodes = snapshot.graph?.nodes ?? [];
      if (
        nodes.some(
          (node) => node.type === "food" && node.foodId && captured.has(node.foodId),
        )
      ) {
        recipeIds.add(row.recipe_id);
      }
    } catch {
      // A corrupt snapshot is a separate problem; it cannot authorise a
      // dangling delete, so skip it here rather than failing the preview.
    }
  }
  return recipeIds.size;
}

/**
 * Rows that reference a captured food. None of these columns has a foreign
 * key, because a food can be a seed fixture in code, so the check is explicit.
 */
function foodReferenceCounts(): Record<"diary" | "plans" | "recipes", number> {
  return {
    diary: count(
      `SELECT COUNT(*) AS n FROM entries e
       JOIN captured_foods f ON f.id = e.food_id`,
    ),
    plans: count(
      `SELECT COUNT(*) AS n FROM plan_entries p
       JOIN captured_foods f ON f.id = p.food_id`,
    ),
    recipes: recipesReferencingCapturedFoods(),
  };
}

/** Diary and plan rows pin a recipe version with a real foreign key. */
function recipeReferenceCounts(): Record<"diary" | "plans", number> {
  return {
    diary: count(`SELECT COUNT(*) AS n FROM entries WHERE recipe_version_id IS NOT NULL`),
    plans: count(
      `SELECT COUNT(*) AS n FROM plan_entries WHERE recipe_version_id IS NOT NULL`,
    ),
  };
}

function foodBlockers(): PurgeBlocker[] {
  const references = foodReferenceCounts();
  return (["diary", "plans", "recipes"] as const)
    .filter((id) => references[id] > 0)
    .map((id) => ({
      category: id,
      label: labelOf(id),
      unit: unitOf(id),
      count: references[id],
    }));
}

function recipeBlockers(): PurgeBlocker[] {
  const references = recipeReferenceCounts();
  return (["diary", "plans"] as const)
    .filter((id) => references[id] > 0)
    .map((id) => ({
      category: id,
      label: labelOf(id),
      unit: unitOf(id),
      count: references[id],
    }));
}

function unresolvedBlockers(selected: ReadonlySet<PurgeCategoryId>): {
  owners: PurgeCategoryId[];
  blockers: PurgeBlocker[];
} {
  const owners: PurgeCategoryId[] = [];
  const blockers: PurgeBlocker[] = [];

  if (selected.has("foods")) {
    const unresolved = foodBlockers().filter((blocker) => !selected.has(blocker.category));
    if (unresolved.length > 0) {
      owners.push("foods");
      blockers.push(...unresolved);
    }
  }

  if (selected.has("recipes")) {
    const unresolved = recipeBlockers().filter((blocker) => !selected.has(blocker.category));
    if (unresolved.length > 0) {
      owners.push("recipes");
      blockers.push(...unresolved);
    }
  }

  return { owners, blockers };
}

function statsFor(id: PurgeCategoryId): { count: number; detail?: string } {
  switch (id) {
    case "diary":
      return { count: count("SELECT COUNT(*) AS n FROM entries") };

    case "plans": {
      const plans = count("SELECT COUNT(*) AS n FROM plans");
      const entries = count("SELECT COUNT(*) AS n FROM plan_entries");
      return {
        count: plans,
        detail:
          entries > 0
            ? `${entries} planned meal${entries === 1 ? "" : "s"}`
            : undefined,
      };
    }

    case "recipes": {
      const recipes = count("SELECT COUNT(*) AS n FROM recipes");
      const versions = count("SELECT COUNT(*) AS n FROM recipe_versions");
      const archived = count(
        "SELECT COUNT(*) AS n FROM recipes WHERE archived_at IS NOT NULL",
      );
      const parts = [
        versions > 0 ? `${versions} version${versions === 1 ? "" : "s"}` : null,
        archived > 0 ? `${archived} archived` : null,
      ].filter((part): part is string => Boolean(part));
      return { count: recipes, detail: parts.length > 0 ? parts.join(" · ") : undefined };
    }

    case "foods": {
      const foods = count("SELECT COUNT(*) AS n FROM captured_foods");
      const nutrients = count("SELECT COUNT(*) AS n FROM captured_food_nutrients");
      const portions = count("SELECT COUNT(*) AS n FROM captured_food_portions");
      // Pins for captured foods are removed with the food, so disclose them
      // here instead of silently deleting another category's rows.
      const pins = count(
        `SELECT COUNT(*) AS n FROM food_default_amounts
         WHERE food_id IN (SELECT id FROM captured_foods)`,
      );
      const images = localEvidenceNames().length;
      const parts = [
        nutrients > 0 ? `${nutrients} nutrient row${nutrients === 1 ? "" : "s"}` : null,
        portions > 0 ? `${portions} portion${portions === 1 ? "" : "s"}` : null,
        pins > 0 ? `${pins} pinned amount${pins === 1 ? "" : "s"}` : null,
        images > 0 ? `${images} image${images === 1 ? "" : "s"}` : null,
      ].filter((part): part is string => Boolean(part));
      return { count: foods, detail: parts.length > 0 ? parts.join(" · ") : undefined };
    }

    case "defaults":
      return { count: count("SELECT COUNT(*) AS n FROM food_default_amounts") };

    case "profile":
      return { count: count("SELECT COUNT(*) AS n FROM profile WHERE id = 'local'") };

    case "preferences": {
      const { sql, keys } = preferenceSql();
      const settings = count(
        `SELECT COUNT(*) AS n FROM app_settings WHERE key IN (${sql})`,
        ...keys,
      );
      const retention = count(
        "SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'user'",
      );
      const parts = [
        settings > 0 ? `${settings} setting${settings === 1 ? "" : "s"}` : null,
        retention > 0
          ? `${retention} retention override${retention === 1 ? "" : "s"}`
          : null,
      ].filter((part): part is string => Boolean(part));
      return {
        count: settings + retention,
        detail: parts.length > 0 ? parts.join(" · ") : undefined,
      };
    }

    case "ai": {
      const calls = count("SELECT COUNT(*) AS n FROM ai_calls");
      const cached = count("SELECT COUNT(*) AS n FROM estimate_cache");
      const parts = [
        calls > 0 ? `${calls} call${calls === 1 ? "" : "s"}` : null,
        cached > 0
          ? `${cached} cached estimate${cached === 1 ? "" : "s"}`
          : null,
      ].filter((part): part is string => Boolean(part));
      return { count: calls + cached, detail: parts.length > 0 ? parts.join(" · ") : undefined };
    }
  }
}

/**
 * What exists now, and what still depends on it.
 *
 * This is a read. The Settings page calls it on every render; the purge calls
 * it again after a commit to report what changed.
 */
export function getPurgePreview(): PurgePreview {
  const foodDependencies = foodBlockers();
  const recipeDependencies = recipeBlockers();

  return {
    categories: PURGE_CATEGORIES.map((spec) => {
      const stats = statsFor(spec.id);
      return {
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        description: spec.description,
        count: stats.count,
        detail: stats.detail,
        blockers:
          spec.id === "foods"
            ? foodDependencies
            : spec.id === "recipes"
              ? recipeDependencies
              : [],
      };
    }),
  };
}

function normalizeCategories(categories: readonly string[]): PurgeCategoryId[] | null {
  if (!Array.isArray(categories)) return null;
  const selected = new Set<PurgeCategoryId>();
  for (const raw of categories) {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    if (!CATEGORY_BY_ID.has(id as PurgeCategoryId)) return null;
    selected.add(id as PurgeCategoryId);
  }
  return [...selected];
}

/**
 * Local evidence names referenced by captured foods.
 *
 * `image_path` is validated on write and on import, but the purge repeats the
 * check: this value reaches a filesystem path, so a hand-edited database row
 * must not be able to escape `data/evidence`.
 */
const EVIDENCE_PREFIX = "data/evidence/";
const EVIDENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Evidence names to remove: every name referenced by a captured food plus
 * every valid file in `data/evidence`.
 *
 * A replace-import can leave an image with no row pointing at it, and an
 * earlier failed unlink can leave a file behind after its row is gone. Both
 * are still the user's photos on the user's disk. A purge of the foods
 * category is the one moment when no row can need them, so that is where the
 * directory is reconciled. Invalid names are never considered: the value
 * may come from a hand-edited database row or a directory entry, and only
 * single-segment names may reach `unlinkSync`.
 */
function localEvidenceNames(): string[] {
  const rows = db
    .prepare(
      `SELECT image_path FROM captured_foods
       WHERE image_path LIKE 'data/evidence/%'`,
    )
    .all() as unknown as Array<{ image_path: string }>;

  const names = new Set<string>();
  for (const row of rows) {
    if (!row.image_path.startsWith(EVIDENCE_PREFIX)) continue;
    const name = row.image_path.slice(EVIDENCE_PREFIX.length);
    if (!EVIDENCE_NAME.test(name)) continue;
    names.add(name);
  }

  try {
    for (const name of readdirSync(path.resolve(dataFile("evidence")))) {
      if (EVIDENCE_NAME.test(name)) names.add(name);
    }
  } catch {
    // No evidence directory yet (or it is unreadable). Row-derived names are
    // still removed; a warning is not useful until there is something to do.
  }

  return [...names];
}

function removeEvidenceFiles(names: readonly string[]): { removed: number; failed: number } {
  if (names.length === 0) return { removed: 0, failed: 0 };

  const root = path.resolve(dataFile("evidence"));
  let removed = 0;
  let failed = 0;

  for (const name of names) {
    if (!EVIDENCE_NAME.test(name)) {
      failed += 1;
      continue;
    }
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) {
      failed += 1;
      continue;
    }
    try {
      if (!existsSync(target)) continue;
      unlinkSync(target);
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  return { removed, failed };
}

function blockedMessage(blockers: readonly PurgeBlocker[]): string {
  const labels = [...new Set(blockers.map((blocker) => blocker.label))];
  const list = labels.join(" and ");
  return `That data is still used by ${list}. Select ${labels.length === 1 ? "that category" : "those categories"} too, or remove the references first.`;
}

/**
 * Delete the selected categories in one transaction.
 *
 * The caller must send category ids, not table names: the id switch below is
 * the allowlist. Unknown ids reject the whole request rather than silently
 * ignoring a typo.
 */
export function purgeData(categories: readonly string[]): PurgeResult {
  const selected = normalizeCategories(categories);
  if (selected === null) {
    return { ok: false, message: "One of those deletion categories is not recognised." };
  }
  if (selected.length === 0) {
    return { ok: false, message: "Choose at least one kind of data to delete." };
  }

  const selectedSet = new Set(selected);
  // Taken inside the write lock below; declared here only so the post-commit
  // count arithmetic can see it. A preview taken before BEGIN IMMEDIATE can
  // be stale by the time another worker commits.
  let before: PurgePreview | null = null;
  const warnings: string[] = [];
  let evidenceNames: string[] = [];
  let filesRemoved = 0;

  try {
    transaction(() => {
      // Re-check against the same connection and lock the database before any
      // row is removed. A stale preview cannot authorise a dangling delete.
      const blocked = unresolvedBlockers(selectedSet);
      if (blocked.owners.length > 0) {
        throw new PurgeBlockedError(blocked.owners, blocked.blockers);
      }

      before = getPurgePreview();

      // Read the file names inside the write transaction: a food added by
      // another process between the preview and here is deleted with the
      // category, so its evidence must be in the list too.
      if (selectedSet.has("foods")) {
        evidenceNames = localEvidenceNames();
      }

      // Children before parents. The order is fixed even when only some
      // categories are selected; a missing delete is a no-op.
      if (selectedSet.has("diary")) {
        db.prepare("DELETE FROM entries").run();
      }

      if (selectedSet.has("plans")) {
        db.prepare("DELETE FROM plan_entries").run();
        db.prepare("DELETE FROM plans").run();
      }

      if (selectedSet.has("recipes")) {
        db.prepare("DELETE FROM component_inputs").run();
        db.prepare("DELETE FROM components").run();
        db.prepare("DELETE FROM recipe_versions").run();
        db.prepare("DELETE FROM recipes").run();
      }

      if (selectedSet.has("foods")) {
        db.prepare("DELETE FROM captured_food_nutrients").run();
        db.prepare("DELETE FROM captured_food_portions").run();
        // Pins for foods that no longer exist would be invisible leftovers.
        db.prepare(
          "DELETE FROM food_default_amounts WHERE food_id IN (SELECT id FROM captured_foods)",
        ).run();
        db.prepare("DELETE FROM captured_foods").run();
      }

      if (selectedSet.has("defaults")) {
        db.prepare("DELETE FROM food_default_amounts").run();
      }

      if (selectedSet.has("profile")) {
        db.prepare("DELETE FROM profile WHERE id = 'local'").run();
      }

      if (selectedSet.has("preferences")) {
        const { sql, keys } = preferenceSql();
        db.prepare(`DELETE FROM app_settings WHERE key IN (${sql})`).run(...keys);
        db.prepare("DELETE FROM retention_factors WHERE origin = 'user'").run();
      }

      if (selectedSet.has("ai")) {
        db.prepare("DELETE FROM ai_calls").run();
        db.prepare("DELETE FROM estimate_cache").run();
      }
    });
  } catch (error) {
    if (error instanceof PurgeBlockedError) {
      return {
        ok: false,
        message: blockedMessage(error.blockers),
        blocked: error.owners,
        blockers: error.blockers,
      };
    }
    throw error;
  }

  // The rows are committed. Files are best-effort: a failure is reported so
  // the user knows an image may still be on disk, but it cannot roll back the
  // database or pretend the delete succeeded silently.
  if (selectedSet.has("foods")) {
    const result = removeEvidenceFiles(evidenceNames);
    filesRemoved = result.removed;
    if (result.failed > 0) {
      warnings.push(
        `${result.failed} evidence image${result.failed === 1 ? "" : "s"} could not be removed. Check data/evidence.`,
      );
    }
  }

  // A user override suppresses the shipped row at boot. Once the override is
  // gone, reconcile the seed now so recipes do not silently fall back to 1.0
  // until the next restart. Failure is not fatal: boot reconciles it again.
  if (selectedSet.has("preferences")) {
    try {
      reseedRetentionFactors();
    } catch {
      warnings.push(
        "Shipped retention factors could not be restored now; they will be restored on the next start.",
      );
    }
  }

  const after = getPurgePreview();
  // `before` is always assigned inside the transaction unless it threw, in
  // which case we never reach here. The fallback keeps the type honest.
  const beforeCounts = (before ?? after).categories;
  const deleted: Partial<Record<PurgeCategoryId, number>> = {};
  for (const id of selected) {
    const beforeCount = beforeCounts.find((category) => category.id === id)?.count ?? 0;
    const afterCount = after.categories.find((category) => category.id === id)?.count ?? 0;
    deleted[id] = Math.max(0, beforeCount - afterCount);
  }

  return { ok: true, deleted, filesRemoved, warnings };
}
