/**
 * Retention-factor table, shared by server and client. No database imports
 * so the canvas can rebuild the lookup in the browser.
 */

import { NUTRIENT_CODES, type NutrientCode } from "./types";
import type { FactorTable } from "./graph";

export interface FactorRow {
  operation: string;
  qualifier: string | null;
  nutrient: string;
  factor: number;
  source: string;
}

export function tableFromRows(rows: FactorRow[]): FactorTable {
  const lookup = new Map<
    string,
    Map<string | null, Map<NutrientCode, { factor: number; source: string }>>
  >();
  for (const row of rows) {
    let byQualifier = lookup.get(row.operation);
    if (!byQualifier) lookup.set(row.operation, (byQualifier = new Map()));
    let byNutrient = byQualifier.get(row.qualifier);
    if (!byNutrient) byQualifier.set(row.qualifier, (byNutrient = new Map()));
    byNutrient.set(row.nutrient as NutrientCode, {
      factor: row.factor,
      source: row.source,
    });
  }
  return { lookup };
}
