import { fmt } from "@/lib/format";
import type { Rollup } from "@/lib/nutrition/engine";
import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";

/**
 * A compact, honest nutrient readout.
 *
 * Partial coverage is shown inline (`3/5`), and an unknown value says so
 * rather than rendering a zero. Shared by the recipe review step and the
 * saved recipe page so both always tell the same story.
 */
export function NutrientRows({
  result,
  codes,
}: {
  result: Rollup;
  codes?: readonly NutrientCode[];
}) {
  const list = codes ?? (Object.keys(NUTRIENTS) as NutrientCode[]);

  return (
    <dl className="space-y-1.5">
      {list.map((code) => {
        const meta = NUTRIENTS[code];
        const total = result.totals[code];
        const coverage = result.coverage[code];
        const partial = total != null && coverage.total > 0 && coverage.known < coverage.total;

        return (
          <div key={code} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-black/60">{meta.label}</dt>
            <dd className="tabular shrink-0 text-right">
              {total == null ? (
                <span className="text-black/30">unknown</span>
              ) : (
                <>
                  <span className="font-medium">{fmt(total, meta.precision)}</span>
                  <span className="text-black/35"> {meta.unit}</span>
                  {partial && (
                    <span className="ml-1.5 text-[10px] text-amber-700/80">
                      {coverage.known}/{coverage.total}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export const MACRO_CODES: NutrientCode[] = [
  "ENERC_KCAL",
  "PROCNT",
  "FAT",
  "CHOCDF",
  "FIBTG",
  "SUGAR",
];

export const MICRO_CODES: NutrientCode[] = [
  "NA",
  "K",
  "CA",
  "FE",
  "ZN",
  "MG",
  "VITA_RAE",
  "VITC",
  "VITD",
  "VITB12",
  "FOL",
  "VITB6",
];
