import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db, reseedRetentionFactors, transaction } from "./client";
import { defaultPersonId, getPerson } from "./people";
import { dataFile } from "@/lib/data-dir";
import {
  IMPORTABLE_PERSON_SETTINGS,
  IMPORTABLE_SETTINGS,
} from "@/lib/archive/registry";

/**
 * Deleting user data by category.
 *
 * Household mode splits deletion into two scopes, because the data is two
 * different things (D-051):
 *
 *   - a `person` purge removes that person's diary, plans, body profile,
 *     pinned amounts and thresholds. It never touches another person, the
 *     shared food/recipe library, evidence files or household settings.
 *   - a `household` purge removes shared recipes, captured foods, household
 *     preferences and the AI log. It never removes a person's diary to make a
 *     shared delete succeed: another person's rows are not the caller's to
 *     discard.
 *
 * Four rules shape this module:
 *
 *   1. **Nothing is implicit.** The caller names each category; a category
 *      deletes exactly the rows described in the scope's category list. Seed
 *      foods, seed retention factors, `meta`, the AI keys and the people
 *      roster are never touched.
 *   2. **No dangling references.** A captured food is referenced by
 *      `entries.food_id`, `plan_entries.food_id` and `component_inputs.food_id`
 *      without a foreign key, and a recipe version is referenced by diary and
 *      plan rows with one. The purge refuses a shared delete while any
 *      person's rows still point at it, and names that person.
 *   3. **Files follow rows.** Evidence images are removed only for a
 *      household `foods` delete, and only after the transaction commits.
 *   4. **The preview and the purge agree.** They run the same queries; the
 *      purge re-checks inside `BEGIN IMMEDIATE`, so a stale or hand-made
 *      selection cannot authorise a dangling delete.
 */

export type PurgeScope = "person" | "household";

export type PurgeCategoryId =
  | "diary"
  | "plans"
  | "profile"
  | "defaults"
  | "preferences"
  | "recipes"
  | "foods"
  | "ai";

export interface PurgeCategorySpec {
  id: PurgeCategoryId;
  label: string;
  unit: string;
  description: string;
}

export const PERSON_PURGE_CATEGORIES: readonly PurgeCategorySpec[] = [
  {
    id: "diary",
    label: "Diary entries",
    unit: "entry",
    description:
      "Every food and recipe logged for this person. Other people and the shared library are untouched.",
  },
  {
    id: "plans",
    label: "Weekly plans",
    unit: "plan",
    description: "This person's weekly plans and every meal placed in them.",
  },
  {
    id: "profile",
    label: "Body profile",
    unit: "profile",
    description:
      "This person's body and goal inputs. Recommended targets fall back to the example profile.",
  },
  {
    id: "defaults",
    label: "Saved default amounts",
    unit: "default",
    description:
      "This person's pinned amounts and units for foods. The foods themselves are kept.",
  },
  {
    id: "preferences",
    label: "Target thresholds",
    unit: "setting",
    description:
      "This person's nutrient status thresholds and per-nutrient overrides. Shipped defaults are restored.",
  },
] as const;

export const HOUSEHOLD_PURGE_CATEGORIES: readonly PurgeCategorySpec[] = [
  {
    id: "recipes",
    label: "Recipes",
    unit: "recipe",
    description:
      "Every recipe, version, block and ingredient line in the shared library. Archived recipes are included.",
  },
  {
    id: "foods",
    label: "Foods you created",
    unit: "food",
    description:
      "Foods the household added, their nutrients, portions, pinned amounts and local evidence images. Foods that ship with the app are kept.",
  },
  {
    id: "preferences",
    label: "Household preferences",
    unit: "setting",
    description:
      "Shared AI instructions and cooking-retention overrides. Shipped defaults are restored.",
  },
  {
    id: "ai",
    label: "AI activity log",
    unit: "record",
    description:
      "The household AI call log and cached nutrient estimates. Saved AI keys are managed separately in AI access.",
  },
] as const;

const CATEGORIES_BY_SCOPE: Record<PurgeScope, readonly PurgeCategorySpec[]> = {
  person: PERSON_PURGE_CATEGORIES,
  household: HOUSEHOLD_PURGE_CATEGORIES,
};

export function purgeCategories(scope: PurgeScope): readonly PurgeCategorySpec[] {
  return CATEGORIES_BY_SCOPE[scope];
}

function categorySpec(scope: PurgeScope, id: PurgeCategoryId): PurgeCategorySpec | null {
  return CATEGORIES_BY_SCOPE[scope].find((spec) => spec.id === id) ?? null;
}

/**
 * A category that must be cleared before the owner can be deleted.
 *
 * Personal blockers name the person whose rows still point at the shared
 * row. `resolvable` says whether selecting that category in the same scope
 * would clear it: a household purge has no diary category, so that blocker
 * has to be cleared in the person's scope instead of being offered as a
 * checkbox that does not exist.
 */
export interface PurgeBlocker {
  category: PurgeCategoryId;
  label: string;
  unit: string;
  count: number;
  personId?: string;
  personName?: string;
  resolvable: boolean;
}

export interface PurgeCategoryPreview {
  id: PurgeCategoryId;
  label: string;
  unit: string;
  description: string;
  /** The category's primary rows, e.g. foods, not their nutrient rows. */
  count: number;
  /** A short breakdown for the UI. */
  detail?: string;
  /** Categories that still reference this data. Empty for leaf categories. */
  blockers: PurgeBlocker[];
}

export interface PurgePreview {
  scope: PurgeScope;
  personId: string | null;
  personName: string | null;
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

function quantity(value: number, unit: string): string {
  if (value === 1) return `${value} ${unit}`;
  const plural = unit.endsWith("y") ? `${unit.slice(0, -1)}ies` : `${unit}s`;
  return `${value} ${plural}`;
}

function sqlList(values: Iterable<string>): string {
  return [...values].map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

const PERSON_SETTINGS_SQL = sqlList(IMPORTABLE_PERSON_SETTINGS);
const HOUSEHOLD_SETTINGS_SQL = sqlList(IMPORTABLE_SETTINGS);

interface PersonCountRow {
  person_id: string;
  person_name: string;
  n: number;
}

function perPersonCounts(sql: string): PersonCountRow[] {
  return db.prepare(sql).all() as unknown as PersonCountRow[];
}

function personalBlocker(
  category: PurgeCategoryId,
  label: string,
  unit: string,
  row: PersonCountRow,
): PurgeBlocker {
  return {
    category,
    label,
    unit,
    count: row.n,
    personId: row.person_id,
    personName: row.person_name,
    resolvable: false,
  };
}

/**
 * Distinct recipes that reference a captured food.
 *
 * A connected v2 food node also becomes a `component_inputs` row, but an
 * unconnected node lives only in the version's snapshot JSON. Counting both
 * sources by recipe id catches a hand-orphaned node that would otherwise make
 * the saved graph fail with "Unknown food" after its food was deleted.
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
 * Diary, plan and recipe references to captured foods, attributed to the
 * person whose rows hold them. Counts are household-wide: one person's
 * selection never waives another person's reference.
 */
function foodBlockers(): PurgeBlocker[] {
  const blockers: PurgeBlocker[] = [];

  for (const row of perPersonCounts(
    `SELECT e.person_id AS person_id, p.display_name AS person_name, COUNT(*) AS n
       FROM entries e
       JOIN captured_foods f ON f.id = e.food_id
       JOIN people p ON p.id = e.person_id
      GROUP BY e.person_id, p.display_name
      ORDER BY p.created_at ASC, p.display_name ASC`,
  )) {
    blockers.push(personalBlocker("diary", "Diary entries", "entry", row));
  }

  for (const row of perPersonCounts(
    `SELECT pl.person_id AS person_id, p.display_name AS person_name, COUNT(*) AS n
       FROM plan_entries pe
       JOIN captured_foods f ON f.id = pe.food_id
       JOIN plans pl ON pl.id = pe.plan_id
       JOIN people p ON p.id = pl.person_id
      GROUP BY pl.person_id, p.display_name
      ORDER BY p.created_at ASC, p.display_name ASC`,
  )) {
    blockers.push(personalBlocker("plans", "Weekly plans", "planned meal", row));
  }

  const recipes = recipesReferencingCapturedFoods();
  if (recipes > 0) {
    blockers.push({
      category: "recipes",
      label: "Recipes",
      unit: "recipe",
      count: recipes,
      resolvable: true,
    });
  }

  return blockers;
}

/** Diary and plan rows that pin a recipe version, attributed by person. */
function recipeBlockers(): PurgeBlocker[] {
  const blockers: PurgeBlocker[] = [];

  for (const row of perPersonCounts(
    `SELECT e.person_id AS person_id, p.display_name AS person_name, COUNT(*) AS n
       FROM entries e
       JOIN people p ON p.id = e.person_id
      WHERE e.recipe_version_id IS NOT NULL
      GROUP BY e.person_id, p.display_name
      ORDER BY p.created_at ASC, p.display_name ASC`,
  )) {
    blockers.push(personalBlocker("diary", "Diary entries", "entry", row));
  }

  for (const row of perPersonCounts(
    `SELECT pl.person_id AS person_id, p.display_name AS person_name, COUNT(*) AS n
       FROM plan_entries pe
       JOIN plans pl ON pl.id = pe.plan_id
       JOIN people p ON p.id = pl.person_id
      WHERE pe.recipe_version_id IS NOT NULL
      GROUP BY pl.person_id, p.display_name
      ORDER BY p.created_at ASC, p.display_name ASC`,
  )) {
    blockers.push(personalBlocker("plans", "Weekly plans", "planned meal", row));
  }

  return blockers;
}

function blockersFor(scope: PurgeScope, id: PurgeCategoryId): PurgeBlocker[] {
  if (scope !== "household") return [];
  if (id === "foods") return foodBlockers();
  if (id === "recipes") return recipeBlockers();
  return [];
}

function unresolvedBlockers(
  scope: PurgeScope,
  selected: ReadonlySet<PurgeCategoryId>,
): { owners: PurgeCategoryId[]; blockers: PurgeBlocker[] } {
  const owners: PurgeCategoryId[] = [];
  const blockers: PurgeBlocker[] = [];

  for (const id of ["foods", "recipes"] as const) {
    if (!selected.has(id)) continue;
    const unresolved = blockersFor(scope, id).filter(
      (blocker) => !(blocker.resolvable && selected.has(blocker.category)),
    );
    if (unresolved.length > 0) {
      owners.push(id);
      blockers.push(...unresolved);
    }
  }

  return { owners, blockers };
}

function statsFor(
  scope: PurgeScope,
  id: PurgeCategoryId,
  personId: string | null,
): { count: number; detail?: string } {
  if (scope === "person") {
    const pid = personId as string;
    switch (id) {
      case "diary":
        return { count: count("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?", pid) };

      case "plans": {
        const plans = count("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?", pid);
        const meals = count(
          `SELECT COUNT(*) AS n FROM plan_entries
            WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
          pid,
        );
        return {
          count: plans,
          detail: meals > 0 ? `${meals} planned meal${meals === 1 ? "" : "s"}` : undefined,
        };
      }

      case "profile":
        return { count: count("SELECT COUNT(*) AS n FROM profile WHERE id = ?", pid) };

      case "defaults":
        return {
          count: count(
            "SELECT COUNT(*) AS n FROM food_default_amounts WHERE person_id = ?",
            pid,
          ),
        };

      case "preferences":
        return {
          count: count(
            `SELECT COUNT(*) AS n FROM person_settings
              WHERE person_id = ? AND key IN (${PERSON_SETTINGS_SQL})`,
            pid,
          ),
        };

      default:
        return { count: 0 };
    }
  }

  switch (id) {
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
      // Pins for captured foods are removed with the food, across every
      // person, so disclose them here instead of deleting another category's
      // rows silently.
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

    case "preferences": {
      const settings = count(
        `SELECT COUNT(*) AS n FROM app_settings WHERE key IN (${HOUSEHOLD_SETTINGS_SQL})`,
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
        cached > 0 ? `${cached} cached estimate${cached === 1 ? "" : "s"}` : null,
      ].filter((part): part is string => Boolean(part));
      return { count: calls + cached, detail: parts.length > 0 ? parts.join(" · ") : undefined };
    }

    default:
      return { count: 0 };
  }
}

/**
 * What exists now, and what still depends on it.
 *
 * This is a read. The Settings page calls it on every render; the purge calls
 * it again after a commit to report what changed.
 */
export function getPurgePreview(
  scope: PurgeScope = "household",
  personId?: string | null,
): PurgePreview {
  if (scope === "person") {
    const resolved = personId ?? defaultPersonId();
    const person = getPerson(resolved);
    if (!person) throw new Error("That person no longer exists.");
    return {
      scope,
      personId: person.id,
      personName: person.displayName,
      categories: PERSON_PURGE_CATEGORIES.map((spec) => {
        const stats = statsFor(scope, spec.id, person.id);
        return {
          id: spec.id,
          label: spec.label,
          unit: spec.unit,
          description: spec.description,
          count: stats.count,
          detail: stats.detail,
          blockers: [],
        };
      }),
    };
  }

  return {
    scope,
    personId: null,
    personName: null,
    categories: HOUSEHOLD_PURGE_CATEGORIES.map((spec) => {
      const stats = statsFor(scope, spec.id, null);
      return {
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        description: spec.description,
        count: stats.count,
        detail: stats.detail,
        blockers: blockersFor(scope, spec.id),
      };
    }),
  };
}

function normalizeCategories(
  scope: PurgeScope,
  categories: readonly string[],
): PurgeCategoryId[] | null {
  if (!Array.isArray(categories)) return null;
  const selected = new Set<PurgeCategoryId>();
  for (const raw of categories) {
    if (typeof raw !== "string") return null;
    const id = raw.trim() as PurgeCategoryId;
    if (!categorySpec(scope, id)) return null;
    selected.add(id);
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
 * are still the user's photos on the user's disk. A household foods purge is
 * the one moment when no row can need them, so that is where the directory is
 * reconciled. Invalid names are never considered: only single-segment names
 * may reach `unlinkSync`.
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

/** "Priya's diary entries (12)", "Recipes (4)" — never a bare count. */
function describeBlocker(blocker: PurgeBlocker): string {
  const owner = blocker.personName ? `${blocker.personName}'s ` : "";
  return `${owner}${blocker.label.toLowerCase()} (${quantity(blocker.count, blocker.unit)})`;
}

function listBlockers(blockers: readonly PurgeBlocker[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const blocker of blockers) {
    const text = describeBlocker(blocker);
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function blockedMessage(blockers: readonly PurgeBlocker[]): string {
  const shared = blockers.filter((blocker) => blocker.resolvable);
  const personal = blockers.filter((blocker) => !blocker.resolvable);
  const list = listBlockers(blockers);

  if (personal.length === 0) {
    const labels = [...new Set(shared.map((blocker) => blocker.label))].join(" and ");
    return `That data is still used by ${list}. Select ${labels} too, or remove the references first.`;
  }
  if (shared.length === 0) {
    return `That data is still used by ${list}. Clear those rows in the relevant person's scope first.`;
  }
  const labels = [...new Set(shared.map((blocker) => blocker.label))].join(" and ");
  return `That data is still used by ${list}. Clear the personal rows in each person's scope, or select ${labels} too.`;
}

/**
 * Delete the selected categories in one transaction.
 *
 * The caller must send a scope and category ids, not table names: the id
 * switch below is the allowlist. Unknown ids reject the whole request rather
 * than silently ignoring a typo. A person purge additionally requires that
 * person to exist; a household purge ignores any person id.
 */
export function purgeData(
  scope: PurgeScope,
  personId: string | null,
  categories: readonly string[],
): PurgeResult {
  if (scope !== "person" && scope !== "household") {
    return { ok: false, message: "That deletion scope is not recognised." };
  }

  let ownerId: string | null = null;
  if (scope === "person") {
    if (!personId) return { ok: false, message: "Choose a person first." };
    const person = getPerson(personId);
    if (!person) return { ok: false, message: "That person no longer exists." };
    ownerId = person.id;
  }

  const selected = normalizeCategories(scope, categories);
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
      const blocked = unresolvedBlockers(scope, selectedSet);
      if (blocked.owners.length > 0) {
        throw new PurgeBlockedError(blocked.owners, blocked.blockers);
      }

      before = getPurgePreview(scope, ownerId);

      if (scope === "person") {
        const id = ownerId as string;

        if (selectedSet.has("diary")) {
          db.prepare("DELETE FROM entries WHERE person_id = ?").run(id);
        }

        if (selectedSet.has("plans")) {
          db.prepare(
            "DELETE FROM plan_entries WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)",
          ).run(id);
          db.prepare("DELETE FROM plans WHERE person_id = ?").run(id);
        }

        if (selectedSet.has("profile")) {
          db.prepare("DELETE FROM profile WHERE id = ?").run(id);
        }

        if (selectedSet.has("defaults")) {
          db.prepare("DELETE FROM food_default_amounts WHERE person_id = ?").run(id);
        }

        if (selectedSet.has("preferences")) {
          db.prepare(
            `DELETE FROM person_settings
              WHERE person_id = ? AND key IN (${PERSON_SETTINGS_SQL})`,
          ).run(id);
        }
      } else {
        // Read the file names inside the write transaction: a food added by
        // another process between the preview and here is deleted with the
        // category, so its evidence must be in the list too.
        if (selectedSet.has("foods")) {
          evidenceNames = localEvidenceNames();
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

        if (selectedSet.has("preferences")) {
          db.prepare(`DELETE FROM app_settings WHERE key IN (${HOUSEHOLD_SETTINGS_SQL})`).run();
          db.prepare("DELETE FROM retention_factors WHERE origin = 'user'").run();
        }

        if (selectedSet.has("ai")) {
          db.prepare("DELETE FROM ai_calls").run();
          db.prepare("DELETE FROM estimate_cache").run();
        }
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
  if (scope === "household" && selectedSet.has("foods")) {
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
  if (scope === "household" && selectedSet.has("preferences")) {
    try {
      reseedRetentionFactors();
    } catch {
      warnings.push(
        "Shipped retention factors could not be restored now; they will be restored on the next start.",
      );
    }
  }

  const after = getPurgePreview(scope, ownerId);
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
