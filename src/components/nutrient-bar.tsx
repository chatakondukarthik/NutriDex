"use client";

import { fmt } from "@/lib/format";
import type { Rollup } from "@/lib/nutrition/engine";
import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import type { Target } from "@/lib/targets";

/**
 * One nutrient against one target.
 *
 * Three states, kept visibly different: `unknown` draws no bar at all,
 * partial coverage says so in words, and a `max` nutrient turns amber
 * rather than green when it goes over. The bar never implies a value the
 * data does not have.
 */
export function NutrientBar({
  code,
  result,
  target,
}: {
  code: NutrientCode;
  result: Rollup;
  target?: Target;
}) {
  const meta = NUTRIENTS[code];
  const total = result.totals[code];
  const coverage = result.coverage[code];
  const unknown = total == null;

  const targetValue = target?.value ?? null;
  const pct =
    targetValue != null && total != null ? Math.min(100, (total / targetValue) * 100) : 0;

  const overLimit =
    target != null && total != null && target.direction === "max" && total > target.value;

  const partial = !unknown && coverage.total > 0 && coverage.known < coverage.total;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-black/70">{meta.label}</span>
        <span className="tabular text-[11px] text-black/45">
          {unknown ? (
            "unknown"
          ) : (
            <>
              {fmt(total, meta.precision)}
              {meta.unit === "kcal" ? "" : ` ${meta.unit}`}
              {targetValue != null && (
                <span className="text-black/25">
                  {" / "}
                  {fmt(targetValue, meta.precision)}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        {!unknown && (
          <div
            className={`bar-fill h-full rounded-full ${
              overLimit ? "bg-amber-500" : "bg-[#1f6f4a]"
            }`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {(partial || unknown) && (
        <div className="mt-0.5 text-[10px] text-black/30">
          {unknown
            ? "no ingredient data"
            : `partial · known for ${coverage.known}/${coverage.total}`}
        </div>
      )}
    </div>
  );
}
