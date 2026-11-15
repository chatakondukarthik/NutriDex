/**
 * Export helpers for the food library. The CSV dialect is simple and
 * RFC-4180-ish (quoted fields) so spreadsheets import it without ceremony.
 */

import type { Food } from "@/lib/nutrition/types";
import { NUTRIENT_CODES, NUTRIENTS } from "@/lib/nutrition/types";

export function toFoodJson(foods: Food[]): string {
  const data = foods.map((food) => ({
    id: food.id,
    name: food.name,
    aliases: food.aliases,
    category: food.category,
    kind: food.kind,
    state: food.state,
    basis: food.basis ?? "per_100g",
    servingSizeG: food.servingSizeG ?? null,
    servingsPerPack: food.servingsPerPack ?? null,
    densityGPerMl: food.densityGPerMl ?? null,
    source: food.source ?? null,
    sourceCode: food.sourceCode ?? null,
    portions: food.portions.map((p) => ({ label: p.label, grams: p.grams })),
    nutrients: Object.fromEntries(
      NUTRIENT_CODES.map((code) => [
        code,
        {
          amount: food.nutrients[code]?.amount ?? null,
          unit: NUTRIENTS[code].unit,
          status: food.nutrients[code]?.status ?? "unknown",
        },
      ]),
    ),
  }));
  return JSON.stringify(data, null, 2);
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toFoodCsv(foods: Food[]): string {
  const header = [
    "id", "name", "aliases", "category", "kind", "state", "basis",
    "servingSizeG", "servingsPerPack", "densityGPerMl", "source", "sourceCode",
    ...NUTRIENT_CODES.map((code) => `${code} (${NUTRIENTS[code].unit})`),
    "portions",
  ];
  const rows = foods.map((food) => [
    food.id,
    food.name,
    food.aliases.join("; "),
    food.category,
    food.kind,
    food.state,
    food.basis ?? "per_100g",
    food.servingSizeG ?? "",
    food.servingsPerPack ?? "",
    food.densityGPerMl ?? "",
    food.source ?? "",
    food.sourceCode ?? "",
    ...NUTRIENT_CODES.map((code) => food.nutrients[code]?.amount ?? ""),
    food.portions.map((p) => `${p.label}=${p.grams}g`).join("; "),
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}
