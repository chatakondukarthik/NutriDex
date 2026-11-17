/**
 * INDB (Indian Nutrient Databank) importer.
 *
 * INDB ships as a CSV with one row per food and one column per nutrient.
 * Column names vary between releases, so the mapping is explicit and editable.
 *
 * Usage:
 *   importInndb(csvText, mapping)  -> { imported, skipped, errors }
 *
 * The importer never overwrites an existing captured food; it skips rows
 * whose name already exists (case-insensitive) unless `overwrite` is set.
 */

import { parseCsv } from "@/lib/importer/csv";
import { prepareCapturedFood } from "@/lib/captured-food";
import { saveCapturedFood } from "@/lib/db/foods";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

export interface InndbMapping {
  /** CSV column holding the food name. */
  name: string;
  /** Optional CSV column for aliases (comma-separated). */
  aliases?: string;
  /** Optional CSV column for category. */
  category?: string;
  /** Optional CSV column for a food code / barcode. */
  code?: string;
  /** Map CSV column name -> nutrient code. */
  nutrients: Record<string, NutrientCode>;
  /** Default category when the column is missing. */
  defaultCategory?: string;
  /** Default kind. */
  defaultKind?: "raw" | "branded" | "composite" | "provisional";
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; name: string; message: string }[];
}

export function importInndb(
  csvText: string,
  mapping: InndbMapping,
  options: { overwrite?: boolean } = {},
): ImportResult {
  const { rows } = parseCsv(csvText);
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  // Hoist the mapping out of the row loop: `Object.entries` per row turned a
  // long mapping into tens of millions of iterations for a full import. A
  // mapping without a `nutrients` map is allowed by the action; treat it as
  // "no nutrient columns" rather than throwing before the first row.
  const nutrientColumns = Object.entries(mapping.nutrients ?? {});
  // `row` is a plain object; a column named `__proto__` would otherwise read
  // the prototype instead of a cell. Only string cells count.
  const cell = (row: Record<string, string>, key: string | undefined): string => {
    if (!key) return "";
    const value = row[key];
    return typeof value === "string" ? value.trim() : "";
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = cell(row, mapping.name);
    if (!name) {
      result.skipped++;
      continue;
    }

    const aliases = mapping.aliases
      ? cell(row, mapping.aliases)
          .split(/[,;]/)
          .map((a) => a.trim())
          .filter(Boolean)
      : [];

    const category = mapping.category
      ? cell(row, mapping.category) || (mapping.defaultCategory ?? "Custom")
      : (mapping.defaultCategory ?? "Custom");

    const code = mapping.code ? cell(row, mapping.code) || undefined : undefined;

    const nutrients: Partial<Record<NutrientCode, number | null>> = {};
    for (const [column, nutrient] of nutrientColumns) {
      const raw = cell(row, column);
      if (raw === "" || raw.toLowerCase() === "na" || raw.toLowerCase() === "tr") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      nutrients[nutrient] = value;
    }

    const prepared = prepareCapturedFood({
      name,
      aliases,
      category,
      kind: mapping.defaultKind ?? "raw",
      state: "raw",
      source: "inndb",
      sourceCode: code,
      nutrients,
    });

    if (!prepared.ok) {
      result.errors.push({ row: i + 2, name, message: prepared.message });
      continue;
    }

    const saved = saveCapturedFood(prepared.food, { allowDuplicate: options.overwrite });
    if (!saved.ok) {
      if (saved.duplicateOf && !options.overwrite) {
        result.skipped++;
        continue;
      }
      result.errors.push({ row: i + 2, name, message: saved.message });
      continue;
    }

    result.imported++;
  }

  return result;
}

/**
 * A default mapping for a typical INDB export. Column names are best guesses;
 * edit to match the actual file's header.
 */
export const DEFAULT_INNDB_MAPPING: InndbMapping = {
  name: "Food name",
  aliases: "Aliases",
  category: "Food group",
  code: "Food code",
  defaultCategory: "Indian",
  defaultKind: "raw",
  nutrients: {
    "Energy (kcal)": "ENERC_KCAL",
    "Protein (g)": "PROCNT",
    "Fat (g)": "FAT",
    "Carbohydrate (g)": "CHOCDF",
    "Dietary fibre (g)": "FIBTG",
    "Total sugars (g)": "SUGAR",
    "Sodium (mg)": "NA",
    "Potassium (mg)": "K",
    "Calcium (mg)": "CA",
    "Iron (mg)": "FE",
    "Zinc (mg)": "ZN",
    "Magnesium (mg)": "MG",
    "Vitamin A (µg)": "VITA_RAE",
    "Vitamin C (mg)": "VITC",
    "Vitamin D (µg)": "VITD",
    "Vitamin B12 (µg)": "VITB12",
    "Folate (µg)": "FOL",
    "Vitamin B6 (mg)": "VITB6",
  },
};
