"use client";

import { useMemo, useState, useTransition } from "react";
import { resetTargetRulesAction, saveTargetRulesAction } from "@/app/actions";
import { fmt } from "@/lib/format";
import { NUTRIENTS, NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import {
  normalizeTargetRules,
  type Target,
  type TargetRules,
} from "@/lib/targets";

/**
 * Thresholds and per-nutrient overrides.
 *
 * Two separate promises are being kept here:
 *
 *   1. the colours are a reading aid, so the numeric rule behind each one is
 *      visible and adjustable instead of hidden in a component;
 *   2. a recommended amount is a starting point, so the user can replace one
 *      nutrient's value without losing the profile-derived value for the
 *      other seventeen.
 *
 * Clearing an override returns that nutrient to the profile recommendation.
 * Percentages are entered as whole numbers (10 means ±10%) because a fraction
 * field invites "0.1" and "10" to mean the same thing to different people.
 */

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/10";
const LABEL = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint";

function percentText(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

function fractionOf(text: string, fallback: number): number {
  const trimmed = text.trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value / 100 : fallback;
}

function overridesToText(rules: TargetRules): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rules.overrides).map(([code, value]) => [code, String(value)]),
  );
}

export function TargetSettingsPanel({
  personId,
  personName,
  initial,
  recommended,
}: {
  /** The person this panel was rendered for; sent with each write. */
  personId: string;
  personName: string;
  initial: TargetRules;
  recommended: Target[];
}) {
  const [amber, setAmber] = useState(() => percentText(initial.amberOver));
  const [red, setRed] = useState(() => percentText(initial.redAt));
  const [tolerance, setTolerance] = useState(() => percentText(initial.tolerance));
  const [sugarTolerance, setSugarTolerance] = useState(() =>
    percentText(initial.sugarTolerance),
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    overridesToText(initial),
  );
  const [baseline, setBaseline] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recommendedByCode = useMemo(
    () => new Map(recommended.map((target) => [target.code, target.value])),
    [recommended],
  );

  const draft = useMemo(
    () =>
      normalizeTargetRules({
        amberOver: fractionOf(amber, baseline.amberOver),
        redAt: fractionOf(red, baseline.redAt),
        tolerance: fractionOf(tolerance, baseline.tolerance),
        sugarTolerance: fractionOf(sugarTolerance, baseline.sugarTolerance),
        overrides: Object.fromEntries(
          Object.entries(overrides)
            .map(([code, value]) => [code, Number(value)] as const)
            .filter(([, value]) => Number.isFinite(value) && value > 0),
        ),
      }),
    [amber, red, tolerance, sugarTolerance, overrides, baseline],
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const overrideCount = Object.keys(draft.overrides).length;

  function applyRules(rules: TargetRules, message: string) {
    setAmber(percentText(rules.amberOver));
    setRed(percentText(rules.redAt));
    setTolerance(percentText(rules.tolerance));
    setSugarTolerance(percentText(rules.sugarTolerance));
    setOverrides(overridesToText(rules));
    setBaseline(rules);
    setSaved(message);
  }

  function save() {
    setSaved(null);
    startTransition(async () => {
      const result = await saveTargetRulesAction(draft, personId);
      if (!result.ok || !result.rules) {
        setSaved(result.message ?? "Could not save.");
        return;
      }
      // Show what was stored, not what was typed: the action clamps.
      applyRules(result.rules, "Saved.");
    });
  }

  function reset() {
    setSaved(null);
    startTransition(async () => {
      const result = await resetTargetRulesAction(personId);
      if (!result.ok) {
        setSaved(result.message ?? "Could not reset.");
        return;
      }
      applyRules(result.rules, "Reset to the documented defaults.");
    });
  }

  function setOverride(code: NutrientCode, value: string) {
    setOverrides((current) => {
      const next = { ...current };
      if (value.trim() === "") delete next[code];
      else next[code] = value;
      return next;
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Status colours and targets</h2>
        <span className="text-[10px] text-ink/40">
          {overrideCount === 0
            ? `All targets from ${personName}'s profile`
            : `${overrideCount} of ${NUTRIENT_CODES.length} targets overridden`}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        These numbers decide when a bar turns amber or red and when a day counts as on target for{" "}
        {personName}. They never change the recommended amounts, which still follow the profile.
        Red is kept at or above amber.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className={LABEL}>Amber above</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              value={amber}
              onChange={(event) => setAmber(event.target.value)}
              aria-label="Amber above, percent over target"
              className={`${FIELD} pr-7`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">
              %
            </span>
          </div>
        </label>

        <label>
          <span className={LABEL}>Red at</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={200}
              step={1}
              value={red}
              onChange={(event) => setRed(event.target.value)}
              aria-label="Red at, percent over target"
              className={`${FIELD} pr-7`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">
              %
            </span>
          </div>
        </label>

        <label>
          <span className={LABEL}>Verdict tolerance</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={1}
              value={tolerance}
              onChange={(event) => setTolerance(event.target.value)}
              aria-label="Verdict tolerance, percent either side of target"
              className={`${FIELD} pr-7`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">
              ±%
            </span>
          </div>
        </label>

        <label>
          <span className={LABEL}>Sugar tolerance</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={1}
              value={sugarTolerance}
              onChange={(event) => setSugarTolerance(event.target.value)}
              aria-label="Sugar tolerance, percent either side of target"
              className={`${FIELD} pr-7`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">
              ±%
            </span>
          </div>
        </label>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Amber at {amber || "0"}% over, red at {red || "0"}% over. A day is “met” within ±
        {tolerance || "0"}% of target (±{sugarTolerance || "0"}% for sugars).
      </p>

      <details className="mt-4 rounded-xl border border-line bg-bg/40">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-ink/70">
          Adjust individual targets
        </summary>
        <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
          {NUTRIENT_CODES.map((code) => {
            const meta = NUTRIENTS[code];
            const recommendation = recommendedByCode.get(code);
            const value = overrides[code] ?? "";
            return (
              <label key={code} className="block">
                <span className="mb-0.5 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-ink/70">{meta.label}</span>
                  {value.trim() !== "" && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-accent">
                      override
                    </span>
                  )}
                </span>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={value}
                    onChange={(event) => setOverride(code, event.target.value)}
                    placeholder={
                      recommendation == null
                        ? "profile"
                        : `${fmt(recommendation, meta.precision)} ${meta.unit}`
                    }
                    aria-label={`${meta.label} daily target, ${meta.unit}`}
                    className={`${FIELD} pr-10`}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">
                    {meta.unit}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
        <p className="border-t border-line px-3 py-2 text-[10px] leading-relaxed text-faint">
          Leave a field empty to keep the profile recommendation shown in grey. An override
          applies to every day and to the week total (seven times the daily value).
        </p>
      </details>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-ink/35">
          {dirty ? "Unsaved changes" : saved ?? "Everything saved"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save thresholds"}
          </button>
        </div>
      </div>
    </section>
  );
}