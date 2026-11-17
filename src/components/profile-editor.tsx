"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useMemo, useState } from "react";
import { saveProfileAction, type ProfileFormState } from "@/app/actions";
import { ChevronDownIcon } from "@/components/icons";
import { useMotionEnabled } from "@/components/theme-provider";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";
import {
  ACTIVITY_LABELS,
  GOAL_LABELS,
  PACE_LABELS,
  energyBreakdown,
  paceRateKgPerWeek,
  parseProfile,
  projectionWeeks,
  type Activity,
  type Goal,
  type Pace,
  type Profile,
  type Sex,
} from "@/lib/profile";
import {
  GUIDANCE_GROUPS,
  DEFAULT_TARGET_RULES,
  targetsFor,
  targetsInRole,
  type Target,
  type TargetRules,
} from "@/lib/targets";
import { NUTRIENTS } from "@/lib/nutrition/types";

const INITIAL: ProfileFormState = { ok: false };

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/10";
const LABEL = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint";

interface Draft {
  sex: Sex;
  ageYears: string;
  heightCm: string;
  weightKg: string;
  bodyFatPercent: string;
  activity: Activity;
  goal: Goal;
  pace: Pace;
  targetWeightKg: string;
  targetEnergyKcal: string;
}

function draftFrom(profile: Profile): Draft {
  return {
    sex: profile.sex,
    ageYears: String(profile.ageYears),
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    bodyFatPercent:
      profile.bodyFatPercent == null ? "" : String(profile.bodyFatPercent),
    activity: profile.activity,
    goal: profile.goal,
    pace: profile.pace,
    targetWeightKg:
      profile.targetWeightKg == null ? "" : String(profile.targetWeightKg),
    targetEnergyKcal:
      profile.targetEnergyKcal == null ? "" : String(profile.targetEnergyKcal),
  };
}

/**
 * The profile editor.
 *
 * Everything in the right-hand column is computed from the inputs as they
 * are typed, using the same pure functions the server uses. That is the
 * point: the user can see exactly which number moved and why before they
 * commit it, instead of saving and wondering why the target jumped.
 *
 * The form still submits through the server action, which re-validates and
 * is the only thing that writes. The live preview is a preview, never the
 * authority.
 */
export function ProfileEditor({
  profile,
  rules = DEFAULT_TARGET_RULES,
}: {
  profile: Profile;
  rules?: TargetRules;
}) {
  const [state, action, pending] = useActionState(saveProfileAction, INITIAL);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(profile));
  const [showMath, setShowMath] = useState(false);
  const motionEnabled = useMotionEnabled();

  const parsed = useMemo(
    () =>
      parseProfile({
        sex: draft.sex,
        ageYears: draft.ageYears,
        heightCm: draft.heightCm,
        weightKg: draft.weightKg,
        activity: draft.activity,
        goal: draft.goal,
        bodyFatPercent: draft.bodyFatPercent,
        pace: draft.pace,
        targetWeightKg: draft.targetWeightKg,
        targetEnergyKcal: draft.targetEnergyKcal,
      }),
    [draft],
  );

  const live = parsed.ok ? parsed.profile : null;
  const breakdown = live ? energyBreakdown(live) : null;
  const targets = live ? targetsFor(live, rules) : [];
  const weeks = live ? projectionWeeks(live) : null;
  const dirty = JSON.stringify(draftFrom(profile)) !== JSON.stringify(draft);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
      <form action={action} className="space-y-5">
        {/* ---- body ---------------------------------------------------- */}
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Your numbers</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Used to work out energy and protein. Body fat is optional — it makes
            the energy estimate more accurate when you know it.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={LABEL}>Sex</span>
              <input type="hidden" name="sex" value={draft.sex} />
              <Segmented
                label="Sex"
                value={draft.sex}
                options={[
                  { value: "female", label: "Female" },
                  { value: "male", label: "Male" },
                ]}
                onChange={(sex) => patch({ sex })}
              />
            </div>

            <label>
              <span className={LABEL}>Age</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="ageYears"
                  min="13"
                  max="100"
                  step="1"
                  required
                  value={draft.ageYears}
                  onChange={(event) => patch({ ageYears: event.target.value })}
                  className={FIELD}
                />
                <span className="text-xs text-muted">years</span>
              </div>
            </label>

            <label>
              <span className={LABEL}>Height</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="heightCm"
                  min="100"
                  max="250"
                  step="0.5"
                  required
                  value={draft.heightCm}
                  onChange={(event) => patch({ heightCm: event.target.value })}
                  className={FIELD}
                />
                <span className="text-xs text-muted">cm</span>
              </div>
            </label>

            <label>
              <span className={LABEL}>Weight</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="weightKg"
                  min="25"
                  max="300"
                  step="0.1"
                  required
                  value={draft.weightKg}
                  onChange={(event) => patch({ weightKg: event.target.value })}
                  className={FIELD}
                />
                <span className="text-xs text-muted">kg</span>
              </div>
            </label>

            <label>
              <span className={LABEL}>
                Body fat <span className="font-normal normal-case text-faint">optional</span>
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="bodyFatPercent"
                  min="3"
                  max="70"
                  step="0.1"
                  value={draft.bodyFatPercent}
                  onChange={(event) => patch({ bodyFatPercent: event.target.value })}
                  placeholder="e.g. 24"
                  className={FIELD}
                />
                <span className="text-xs text-muted">%</span>
              </div>
            </label>

            <label className="sm:col-span-2">
              <span className={LABEL}>Activity</span>
              <select
                name="activity"
                value={draft.activity}
                onChange={(event) =>
                  patch({ activity: event.target.value as Activity })
                }
                className={FIELD}
              >
                {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((value) => (
                  <option key={value} value={value}>
                    {ACTIVITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ---- goal ---------------------------------------------------- */}
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Goal</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The goal changes the energy target and the protein target. Pace
            changes only the size of the energy adjustment.
          </p>

          <div className="mt-4">
            <span className={LABEL}>What are you aiming for?</span>
            <input type="hidden" name="goal" value={draft.goal} />
            <Segmented
              label="Goal"
              value={draft.goal}
              options={[
                { value: "lose", label: "Lose fat" },
                { value: "maintain", label: "Maintain" },
                { value: "gain", label: "Gain muscle" },
              ]}
              onChange={(goal) => patch({ goal })}
            />
          </div>

          <AnimatePresence initial={false}>
            {draft.goal !== "maintain" && (
              <motion.div
                key="pace"
                initial={motionEnabled ? { height: 0, opacity: 0 } : false}
                animate={{ height: "auto", opacity: 1 }}
                exit={motionEnabled ? { height: 0, opacity: 0 } : undefined}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4">
                  <span className={LABEL}>Pace</span>
                  <input type="hidden" name="pace" value={draft.pace} />
                  <Segmented
                    label="Pace"
                    value={draft.pace}
                    options={(["gentle", "steady", "fast"] as Pace[]).map((pace) => ({
                      value: pace,
                      label: PACE_LABELS[pace],
                      detail: paceDetail(live, pace),
                    }))}
                    onChange={(pace) => patch({ pace })}
                    stacked
                  />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                    The rate is a share of your current weight, so it updates as
                    your weight changes. Loss above 1% of body weight a week is
                    usually hard to keep lean mass on.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <label className="mt-4 block">
            <span className={LABEL}>
              Target weight{" "}
              <span className="font-normal normal-case text-faint">optional</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                name="targetWeightKg"
                min="25"
                max="300"
                step="0.1"
                value={draft.targetWeightKg}
                onChange={(event) => patch({ targetWeightKg: event.target.value })}
                placeholder="used for the time estimate only"
                className={FIELD}
              />
              <span className="text-xs text-muted">kg</span>
            </div>
          </label>

          {live && draft.goal !== "maintain" && draft.targetWeightKg !== "" && (
            <p className="mt-2 rounded-control bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
              {weeks != null
                ? `About ${weeks} ${weeks === 1 ? "week" : "weeks"} at this pace, if the rate stays steady.`
                : "A target weight needs to be on the side you are heading toward — below your current weight to lose, above it to gain."}
            </p>
          )}

          <label className="mt-4 block">
            <span className={LABEL}>
              Energy target override{" "}
              <span className="font-normal normal-case text-faint">optional</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                name="targetEnergyKcal"
                min="800"
                max="6000"
                step="10"
                value={draft.targetEnergyKcal}
                onChange={(event) => patch({ targetEnergyKcal: event.target.value })}
                placeholder="leave blank to use the calculated value"
                className={FIELD}
              />
              <span className="text-xs text-muted">kcal</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Overrides the derived daily energy target. Use this when you already know your number.
            </p>
          </label>
        </section>

        {/* ---- calculation --------------------------------------------- */}
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <button
            type="button"
            onClick={() => setShowMath((current) => !current)}
            aria-expanded={showMath}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span>
              <span className="block text-sm font-semibold">
                How this is calculated
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                The equation, the activity multiplier and the safety rails.
              </span>
            </span>
            <ChevronDownIcon
              className={cn(
                "h-4 w-4 shrink-0 text-faint transition-transform",
                showMath && "rotate-180",
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {showMath && breakdown && (
              <motion.div
                initial={motionEnabled ? { height: 0, opacity: 0 } : false}
                animate={{ height: "auto", opacity: 1 }}
                exit={motionEnabled ? { height: 0, opacity: 0 } : undefined}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-1.5 rounded-control bg-surface-2 px-3 py-3 text-[11px]">
                  <Row
                    label={
                      breakdown.bmrSource === "katch"
                        ? "Basal rate · Katch–McArdle"
                        : "Basal rate · Mifflin–St Jeor"
                    }
                    value={`${fmt(breakdown.bmr, 0)} kcal`}
                  />
                  <p className="pb-1 text-[10px] leading-relaxed text-faint">
                    {breakdown.bmrFormula}
                  </p>
                  <Row
                    label={`Activity × ${breakdown.activityMultiplier}`}
                    value={`${fmt(breakdown.maintenance, 0)} kcal maintenance`}
                  />
                  <Row
                    label="Goal adjustment"
                    value={
                      breakdown.delta === 0
                        ? "none"
                        : `${breakdown.delta > 0 ? "+" : "−"}${fmt(
                            Math.abs(breakdown.delta),
                            0,
                          )} kcal`
                    }
                  />
                  {breakdown.cap && (
                    <p className="pb-1 text-[10px] leading-relaxed text-warn-ink">
                      {capNote(breakdown.cap, breakdown.floor)}
                    </p>
                  )}
                  <Row
                    label="Daily energy target"
                    value={`${fmt(breakdown.target, 0)} kcal`}
                    strong
                  />
                  <div className="my-1.5 border-t border-line" />
                  <Row
                    label={`Protein · ${breakdown.proteinPerKg} g/kg`}
                    value={`${fmt(breakdown.protein, 0)} g`}
                  />
                  <Row
                    label="Fat ceiling · 30% of energy"
                    value={`${fmt(breakdown.fat, 0)} g`}
                  />
                  <Row
                    label="Sugar ceiling · 10% of energy"
                    value={`${fmt(breakdown.sugar, 0)} g`}
                  />
                  <Row
                    label="Fibre · 14 g per 1,000 kcal"
                    value={`${fmt(breakdown.fibre, 0)} g`}
                  />
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-faint">
                  An energy estimate is not a measurement. Mifflin–St Jeor is
                  typically within about 10% for most adults; Katch–McArdle uses
                  lean mass when body fat is known. Use the scale and how you
                  feel over two to three weeks to adjust — not one day.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !parsed.ok}
            className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save profile"}
          </button>

          {!parsed.ok && (
            <p className="text-[11px] text-danger">{parsed.message}</p>
          )}
          {parsed.ok && state.message && (
            <p className={cn("text-[11px]", state.ok ? "text-accent" : "text-danger")}>
              {state.message}
            </p>
          )}
          {parsed.ok && dirty && !state.message && (
            <p className="text-[11px] text-faint">
              Preview updated. Save to use these targets everywhere.
            </p>
          )}
        </div>
      </form>

      {/* ---- live targets ------------------------------------------------ */}
      <aside className="lg:sticky lg:top-20">
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Live targets</h2>
            {live && (
              <span className="tabular text-[11px] text-muted">
                {fmt(breakdown ? breakdown.target : null, 0)} kcal
              </span>
            )}
          </div>

          {live && breakdown ? (
            <>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="tabular text-3xl font-semibold leading-none">
                  {fmt(breakdown.target, 0)}
                </span>
                <span className="text-xs text-muted">kcal / day</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                {breakdown.goal === "maintain"
                  ? "Maintenance, with no deficit or surplus."
                  : `${fmt(breakdown.effectiveRateKgPerWeek, 2)} kg / week ${
                      breakdown.goal === "lose" ? "loss" : "gain"
                    } · ${fmt(breakdown.effectivePercentPerWeek, 2)}% of body weight.`}
              </p>

              {breakdown.cap && (
                <p className="mt-2 rounded-control border border-warn-line bg-warn-soft px-2.5 py-1.5 text-[10px] leading-relaxed text-warn-ink">
                  {capNote(breakdown.cap, breakdown.floor)}
                </p>
              )}

              <div className="mt-4 space-y-4">
                {GUIDANCE_GROUPS.map((group) => {
                  const groupTargets = targetsInRole(targets, group.role);
                  return (
                    <div key={group.role}>
                      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {group.label}
                      </h3>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                        {group.blurb}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {groupTargets.map((target) => (
                          <TargetRow key={target.code} target={target} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-faint">
                Reference values, not medical advice. Minerals and vitamins are
                ICMR–NIN 2020 seed values pending a verified review.
              </p>
            </>
          ) : (
            <p className="mt-3 rounded-control border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              Finish the numbers to see targets.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  stacked = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail?: string | null }>;
  onChange: (value: T) => void;
  stacked?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex gap-1 rounded-control bg-ink/5 p-1",
        stacked ? "flex-col sm:flex-row" : "flex-row",
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative flex-1 rounded-lg px-2 py-2 text-left text-xs font-medium transition",
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <span className="block">{option.label}</span>
            {option.detail && (
              <span className="mt-0.5 block text-[10px] font-normal text-faint">
                {option.detail}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={strong ? "font-medium text-ink" : "text-muted"}>{label}</span>
      <span
        className={cn(
          "tabular shrink-0",
          strong ? "font-semibold text-ink" : "text-ink/70",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TargetRow({ target }: { target: Target }) {
  const meta = NUTRIENTS[target.code];
  return (
    <li className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="min-w-0 truncate text-muted">{meta.label}</span>
      <span className="tabular shrink-0 text-ink/70">
        {fmt(target.value, meta.precision)} {meta.unit}
      </span>
    </li>
  );
}

/**
 * The kg/week a pace means at the current weight, for the option subtitle.
 *
 * Deliberately calls the same function the target uses. An earlier version
 * recomputed the fraction here and showed "0.49 kg/week" next to a target
 * built from 0.5 — two numbers for one decision.
 */
function paceDetail(profile: Profile | null, pace: Pace): string | null {
  if (profile == null || profile.goal === "maintain") return null;

  const rate = paceRateKgPerWeek({ ...profile, pace });
  if (rate <= 0) return null;

  return `${fmt(rate, 2)} kg / week`;
}

function capNote(cap: NonNullable<ReturnType<typeof energyBreakdown>["cap"]>, floor: number): string {
  if (cap === "deficit") {
    return "The pace asked for a larger deficit than 25% of maintenance, so the deficit is capped there.";
  }
  if (cap === "surplus") {
    return "The pace asked for a larger surplus than 15% of maintenance, so the surplus is capped there.";
  }
  return `That would put you below ${fmt(floor, 0)} kcal, so the target is held at the floor.`;
}
