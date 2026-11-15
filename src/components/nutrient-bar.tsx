"use client";

import { fmt } from "@/lib/format";
import type { Rollup } from "@/lib/nutrition/engine";
import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import type { Assessment, AssessmentStatus, Target } from "@/lib/targets";

/**
 * One nutrient against one reference amount.
 *
 * Two callers, one look:
 *
 * - the diary has a raw rollup and a daily target, so it asks for a bar;
 * - the plan has already judged a day or a week, so it passes the verdict
 *   and the bar colours itself from it.
 *
 * The states stay visibly different. `unknown` draws no bar at all,
 * partial coverage says so in words, a shortfall is amber, and an amount
 * that is only a weekly concern is grey rather than red — a low-fibre
 * Tuesday is not a mistake.
 */

type NutrientBarProps =
  | { code: NutrientCode; assessment: Assessment }
  | { code: NutrientCode; result: Rollup; target?: Target };

export function NutrientBar(props: NutrientBarProps) {
  const { code } = props;
  const meta = NUTRIENTS[code];

  const view =
    "assessment" in props
      ? {
          actual: props.assessment.actual,
          reference: props.assessment.target,
          status: props.assessment.status,
          coverage: props.assessment.coverage,
        }
      : {
          actual: props.result.totals[code],
          reference: props.target?.value ?? null,
          status: localStatus(props.result.totals[code], props.target),
          coverage: props.result.coverage[code],
        };

  const unknown = view.actual == null;
  const pct =
    view.reference != null && view.actual != null && view.reference > 0
      ? Math.min(100, (view.actual / view.reference) * 100)
      : 0;

  const partial =
    !unknown && view.coverage.total > 0 && view.coverage.known < view.coverage.total;

  // Overflow escalation: going over a target is fine for weekly-minimums,
  // but for everything else (and for all nutrients once you are clearly
  // past it) the bar escalates yellow -> red. See docs/research Q-011.
  const ratio =
    view.reference != null && view.actual != null && view.reference > 0
      ? view.actual / view.reference
      : 0;
  const overflow: "none" | "warn" | "danger" =
    unknown || view.reference == null
      ? "none"
      : ratio >= 1.25
        ? "danger"
        : ratio >= 1.1
          ? "warn"
          : "none";

  const fillClass =
    overflow === "danger"
      ? "bg-danger"
      : overflow === "warn"
        ? "bg-warn"
        : FILL[view.status];

  const note = statusNote(view.status, partial, unknown, overflow);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink/70">{meta.label}</span>
        <span className="tabular text-[11px] text-ink/45">
          {unknown ? (
            "unknown"
          ) : (
            <>
              {fmt(view.actual, meta.precision)}
              {meta.unit === "kcal" ? "" : ` ${meta.unit}`}
              {view.reference != null && (
                <span className="text-ink/25">
                  {" / "}
                  {fmt(view.reference, meta.precision)}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <div
        role="img"
        aria-label={`${meta.label}: ${
          unknown
            ? "no data"
            : `${fmt(view.actual, meta.precision)} ${meta.unit} of ${fmt(
                view.reference,
                meta.precision,
              )}${note ? `, ${note}` : ""}`
        }`}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10"
      >
        {!unknown && (
          <div
            className={`bar-fill h-full rounded-full ${fillClass}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {note && (
        <div
          className={`mt-0.5 text-[10px] ${
            view.status === "low" || view.status === "high" || overflow !== "none"
              ? overflow === "danger"
                ? "text-danger-ink"
                : "text-warn-ink"
              : "text-ink/30"
          }`}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * A bar that has not been judged yet still has to be honest about what it
 * knows. The diary has no week to average over, so it only passes
 * judgement where a day is the right window: the anchors, and a ceiling
 * that has actually been crossed. A low-fibre Tuesday stays grey.
 */
function localStatus(total: number | null, target?: Target): AssessmentStatus {
  if (total == null) return "unknown";
  if (!target) return "neutral";

  const ratio = total / target.value;
  if (target.direction === "max" && ratio > 1 + target.tolerance) return "high";
  if (ratio >= 1 - target.tolerance) return "met";
  if (target.direction === "max") return "met";

  // A shortfall is only a problem on a daily anchor (energy, protein).
  // Everything else is a weekly average, so a single day is not a verdict.
  return target.role === "daily-anchor" ? "low" : "neutral";
}

const FILL: Record<AssessmentStatus, string> = {
  // Green only when the amount is where it should be.
  met: "bg-accent",
  // Amber for "look at this": a low anchor or an exceeded ceiling.
  low: "bg-warn",
  high: "bg-warn",
  // Grey for a day that simply is not the right window to judge it in.
  neutral: "bg-ink/25",
  unknown: "bg-ink/10",
};

function statusNote(
  status: AssessmentStatus,
  partial: boolean,
  unknown: boolean,
  overflow: "none" | "warn" | "danger",
): string | null {
  if (unknown) return "no ingredient data";

  const parts: string[] = [];
  if (status === "low") parts.push("below target");
  if (status === "high") parts.push("over the limit");
  if (overflow === "warn") parts.push("over target");
  if (overflow === "danger") parts.push("well over target");
  // `neutral` is deliberately silent: the guidance group already says this
  // nutrient is judged over the week, and repeating it on every row buries
  // the rows that do have something to say.
  if (partial) parts.push("partial data");

  return parts.length ? parts.join(" · ") : null;
}
