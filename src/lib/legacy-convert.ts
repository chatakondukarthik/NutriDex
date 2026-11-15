/**
 * One-time conversion of legacy (v1, linear-block) recipes to graphs (v2).
 *
 * Creates a new version per converted recipe; existing versions remain
 * untouched and plans keep their pins (D-045).
 */

import { db } from "@/lib/db/client";
import { listRecipes, getVersion } from "@/lib/db/recipes";
import { getFood } from "@/lib/db/foods";
import { saveGraphDraft } from "@/lib/recipes-v2";

export interface ConvertResult {
  converted: number;
  skipped: number;
  errors: { name: string; message: string }[];
}

export function isLegacySnapshot(snapshotJson: string): boolean {
  try {
    const parsed = JSON.parse(snapshotJson);
    return (parsed?.calculationVersion ?? "1") === "1";
  } catch {
    return true;
  }
}

export function convertAllLegacyRecipes(): ConvertResult {
  const result: ConvertResult = { converted: 0, skipped: 0, errors: [] };

  const rows = db
    .prepare(`SELECT id, name, current_version_id FROM recipes WHERE archived_at IS NULL`)
    .all() as unknown as Array<{ id: string; name: string; current_version_id: string | null }>;

  const foods = new Map<string, NonNullable<ReturnType<typeof getFood>>>();

  for (const row of rows) {
    if (!row.current_version_id) {
      result.skipped++;
      continue;
    }
    const version = getVersion(row.current_version_id);
    if (!version) {
      result.skipped++;
      continue;
    }

    const snapshotRow = db
      .prepare(`SELECT snapshot, calculation_version FROM recipe_versions WHERE id = ?`)
      .get(row.current_version_id) as unknown as { snapshot: string; calculation_version: string } | undefined;
    if (!snapshotRow) {
      result.skipped++;
      continue;
    }
    if (snapshotRow.calculation_version !== "1") {
      result.skipped++;
      continue;
    }

    // Build the graph: one food node per input, one process node per block,
    // chained in order. Mass carries over from the stored grams.
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<{ id: string; from: string; to: string }> = [];

    let previous: string | null = null;
    version.blocks.forEach((block, blockIndex) => {
      const processId = `c${blockIndex}`;
      const operation = block.operation?.trim() || "assemble";
      nodes.push({
        id: processId,
        type: "process",
        operation,
        name: block.name?.trim() || `Step ${blockIndex + 1}`,
        measuredOutputs: block.outputGrams != null && block.outputGrams > 0 ? [block.outputGrams] : [null],
        outputs: [{ label: block.name?.trim() || `Step ${blockIndex + 1} output`, tag: "consumed", split: {} }],
      });

      block.inputs.forEach((input) => {
        if (!foods.has(input.foodId)) {
          const resolved = getFood(input.foodId);
          if (resolved) foods.set(input.foodId, resolved);
        }
        const food = foods.get(input.foodId);
        if (!food) return;
        const foodId = `c${blockIndex}-f${nodes.length}`;
        nodes.push({ id: foodId, type: "food", foodId: input.foodId, grams: input.grams });
        edges.push({ id: `${processId}-${foodId}`, from: foodId, to: processId });
      });

      if (previous) edges.push({ id: `${previous}-${processId}`, from: previous, to: processId });
      previous = processId;
    });

    const graph = { nodes, edges };
    try {
      const saved = saveGraphDraft({
        recipeId: row.id,
        name: row.name,
        instructions: version.instructions,
        servings: version.servings,
        versionLabel: "flow format",
        graph: graph as never,
      });
      if (!saved.ok) {
        result.errors.push({ name: row.name, message: saved.message ?? "Save failed." });
        continue;
      }
      result.converted++;
    } catch (error) {
      result.errors.push({
        name: row.name,
        message: error instanceof Error ? error.message : "Conversion failed.",
      });
    }
  }

  return result;
}
