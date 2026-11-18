"use client";

import { useMemo } from "react";
import {
  NUTRIENTS,
  NUTRIENT_CODES,
  type NutrientCode,
  type NutrientGroup,
} from "@/lib/nutrition/types";

/**
 * The nutrient picker used wherever a run of AI estimation is about to
 * write into shared records. The user picks exactly which nutrients the
 * model may propose; nothing outside the selection is touched, and known
 * values are never overwritten regardless of selection.
 *
 * Operate-mode rules: native checkboxes, one click per decision, live
 * counts, no derived state hidden from the user.
 */

const GROUP_ORDER: NutrientGroup[] = ["energy", "macro", "mineral", "vitamin"];
const GROUP_LABEL: Record<NutrientGroup, string> = {
  energy: "Energy",
  macro: "Macros",
  mineral: "Minerals",
  vitamin: "Vitamins",
};
const ENERGY_MACROS: NutrientCode[] = ["ENERC_KCAL", "PROCNT", "FAT", "CHOCDF", "FIBTG", "SUGAR"];

const box =
  "size-3.5 shrink-0 accent-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40";
const preset =
  "rounded-md border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-muted transition hover:text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40";

export function NutrientPicker({
  options,
  value,
  onChange,
  disabled = false,
  idPrefix = "nutrient",
}: {
  /** Codes offered for selection — for foods, the ones currently unknown. */
  options: readonly NutrientCode[];
  value: ReadonlySet<NutrientCode>;
  onChange: (next: Set<NutrientCode>) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        codes: NUTRIENT_CODES.filter(
          (code) => options.includes(code) && NUTRIENTS[code].group === group,
        ),
      })).filter((entry) => entry.codes.length > 0),
    [options],
  );

  const selectedCount = options.reduce((n, code) => n + (value.has(code) ? 1 : 0), 0);

  function toggleOne(code: NutrientCode) {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  function toggleGroup(codes: NutrientCode[]) {
    const next = new Set(value);
    const every = codes.every((code) => next.has(code));
    if (every) for (const code of codes) next.delete(code);
    else for (const code of codes) next.add(code);
    onChange(next);
  }

  if (options.length === 0) {
    return (
      <p className="mt-2 rounded-md border border-line bg-bg px-3 py-2 text-[10px] leading-snug text-muted">
        Every tracked nutrient here is already filled in — nothing for the AI to add.
      </p>
    );
  }

  return (
    <div className={disabled ? "opacity-60" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(new Set(options))}
            disabled={disabled}
            className={preset}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set(options.filter((code) => ENERGY_MACROS.includes(code))))}
            disabled={disabled}
            className={preset}
          >
            Energy + macros
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            disabled={disabled}
            className={preset}
          >
            Clear
          </button>
        </div>
        <span className="tabular shrink-0 text-[10px] font-medium text-ink/45">
          {selectedCount} of {options.length} selected
        </span>
      </div>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {groups.map(({ group, codes }) => {
          const inGroup = codes.filter((code) => value.has(code)).length;
          const all = inGroup === codes.length;
          const some = inGroup > 0 && !all;
          return (
            <div
              key={group}
              role="group"
              aria-label={GROUP_LABEL[group]}
              className="min-w-0 rounded-lg border border-line bg-bg p-2"
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink/50">
                <input
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  type="checkbox"
                  checked={all}
                  disabled={disabled}
                  onChange={() => toggleGroup(codes)}
                  aria-label={`All ${GROUP_LABEL[group].toLowerCase()}`}
                  className={box}
                />
                {GROUP_LABEL[group]}
                <span className="tabular ml-auto font-normal text-ink/35">
                  {inGroup}/{codes.length}
                </span>
              </label>
              <ul className="mt-1 space-y-0.5">
                {codes.map((code) => (
                  <li key={code}>
                    <label
                      htmlFor={`${idPrefix}-${code}`}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-[3px] transition hover:bg-ink/5"
                    >
                      <input
                        id={`${idPrefix}-${code}`}
                        type="checkbox"
                        checked={value.has(code)}
                        disabled={disabled}
                        onChange={() => toggleOne(code)}
                        className={box}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink/85">
                        {NUTRIENTS[code].label}
                      </span>
                      <span className="tabular shrink-0 text-[9px] text-ink/35">
                        {NUTRIENTS[code].unit}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
