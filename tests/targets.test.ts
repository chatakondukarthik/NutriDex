import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NutrientCoverage, Rollup } from "@/lib/nutrition/engine";
import { NUTRIENT_CODES, type NutrientCode, type NutrientStatus } from "@/lib/nutrition/types";
import { DEFAULT_PROFILE } from "@/lib/profile";
import {
  DEFAULT_TARGET_RULES,
  assessDay,
  assessWeek,
  isDefaultTargetRules,
  normalizeTargetRules,
  targetsFor,
  type TargetRules,
} from "@/lib/targets";

/**
 * S8 — status colour and user-editable targets.
 *
 * Three promises:
 *
 *   1. the documented defaults are the behaviour the app shipped with;
 *   2. a submitted or restored rule set is parsed, not trusted;
 *   3. the thresholds reach both the verdict and the bar through the target,
 *      so a colour cannot disagree with the status it is drawn beside.
 */

function rollup(values: Partial<Record<NutrientCode, number | null>>): Rollup {
  const totals = {} as Record<NutrientCode, number | null>;
  const status = {} as Record<NutrientCode, NutrientStatus>;
  const coverage = {} as Record<NutrientCode, NutrientCoverage>;

  for (const code of NUTRIENT_CODES) {
    const value = code in values ? values[code]! : 0;
    totals[code] = value;
    status[code] = value == null ? "unknown" : "known";
    coverage[code] = value == null ? { known: 0, total: 1 } : { known: 1, total: 1 };
  }

  return { totals, status, coverage };
}

describe("normalizeTargetRules", () => {
  it("returns the documented defaults for an empty value", () => {
    expect(normalizeTargetRules(undefined)).toEqual(DEFAULT_TARGET_RULES);
    expect(normalizeTargetRules({})).toEqual(DEFAULT_TARGET_RULES);
    expect(isDefaultTargetRules(normalizeTargetRules({}))).toBe(true);
  });

  it("keeps red at or above amber", () => {
    const rules = normalizeTargetRules({ amberOver: 0.4, redAt: 0.1 });
    expect(rules.amberOver).toBe(0.4);
    expect(rules.redAt).toBe(0.4);
  });

  it("clamps percentages and tolerances into a range the screen can explain", () => {
    const rules = normalizeTargetRules({
      amberOver: -2,
      redAt: 99,
      tolerance: -1,
      sugarTolerance: 9,
    });
    expect(rules.amberOver).toBe(0);
    expect(rules.redAt).toBe(2);
    expect(rules.tolerance).toBe(0);
    expect(rules.sugarTolerance).toBe(0.5);
  });

  it("drops unknown nutrient codes and non-positive values", () => {
    const rules = normalizeTargetRules({
      overrides: {
        PROCNT: 120,
        NA: 0,
        FAT: -5,
        NOT_A_NUTRIENT: 12,
        FE: "18",
      },
    });
    expect(rules.overrides).toEqual({ PROCNT: 120, FE: 18 });
  });
});

describe("targetsFor", () => {
  it("uses profile recommendations when there are no overrides", () => {
    const targets = targetsFor(DEFAULT_PROFILE);
    expect(targets).toHaveLength(NUTRIENT_CODES.length);

    const protein = targets.find((target) => target.code === "PROCNT")!;
    const baseline = targetsFor(DEFAULT_PROFILE, DEFAULT_TARGET_RULES).find(
      (target) => target.code === "PROCNT",
    )!;
    expect(protein.value).toBe(baseline.value);
    expect(protein.amberOver).toBe(0);
    expect(protein.redAt).toBe(0.2);
  });

  it("applies an override without moving the other nutrients", () => {
    const rules: TargetRules = {
      ...DEFAULT_TARGET_RULES,
      overrides: { PROCNT: 150 },
    };
    const baseline = targetsFor(DEFAULT_PROFILE);
    const adjusted = targetsFor(DEFAULT_PROFILE, rules);

    const protein = adjusted.find((target) => target.code === "PROCNT")!;
    expect(protein.value).toBe(150);

    const baselineIron = baseline.find((target) => target.code === "FE")!;
    const adjustedIron = adjusted.find((target) => target.code === "FE")!;
    expect(adjustedIron.value).toBe(baselineIron.value);
  });

  it("gives sugars the sugar tolerance and everything else the general one", () => {
    const targets = targetsFor(DEFAULT_PROFILE, {
      ...DEFAULT_TARGET_RULES,
      tolerance: 0.05,
      sugarTolerance: 0.25,
    });
    expect(targets.find((target) => target.code === "SUGAR")!.tolerance).toBe(0.25);
    expect(targets.find((target) => target.code === "NA")!.tolerance).toBe(0.05);
  });

  it("carries the thresholds onto every target", () => {
    const targets = targetsFor(DEFAULT_PROFILE, {
      ...DEFAULT_TARGET_RULES,
      amberOver: 0.1,
      redAt: 0.35,
    });
    expect(targets.every((target) => target.amberOver === 0.1 && target.redAt === 0.35)).toBe(
      true,
    );
  });
});

describe("assessment uses the target's thresholds", () => {
  it("calls a day high only past the verdict tolerance", () => {
    const targets = targetsFor(DEFAULT_PROFILE, {
      ...DEFAULT_TARGET_RULES,
      tolerance: 0.2,
    });
    const energy = targets.find((target) => target.code === "ENERC_KCAL")!;

    const within = assessDay(rollup({ ENERC_KCAL: energy.value * 1.15 }), targets).find(
      (assessment) => assessment.code === "ENERC_KCAL",
    )!;
    expect(within.status).toBe("met");

    const past = assessDay(rollup({ ENERC_KCAL: energy.value * 1.25 }), targets).find(
      (assessment) => assessment.code === "ENERC_KCAL",
    )!;
    expect(past.status).toBe("high");
  });

  it("puts the thresholds on the assessment for the bar to read", () => {
    const targets = targetsFor(DEFAULT_PROFILE, {
      ...DEFAULT_TARGET_RULES,
      amberOver: 0.05,
      redAt: 0.3,
    });
    const [assessment] = assessDay(rollup({}), targets);
    expect(assessment.amberOver).toBe(0.05);
    expect(assessment.redAt).toBe(0.3);
  });

  it("judges a weekly limit on the week, not on one day", () => {
    const targets = targetsFor(DEFAULT_PROFILE);
    const sodium = targets.find((target) => target.code === "NA")!;

    const day = assessDay(rollup({ NA: sodium.value * 1.5 }), targets).find(
      (assessment) => assessment.code === "NA",
    )!;
    expect(day.status).toBe("high");

    const week = assessWeek(
      [rollup({ NA: sodium.value * 1.5 }), ...Array.from({ length: 6 }, () => rollup({ NA: 0 }))],
      targets,
    ).find((assessment) => assessment.code === "NA")!;
    expect(week.status).toBe("met");
  });
});

describe("persistence", () => {
  let dir: string;
  let settings: typeof import("@/lib/db/settings");
  let registry: typeof import("@/lib/archive/registry");
  let db: typeof import("@/lib/db/client")["db"];
  let personId: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "nutriplan-target-rules-"));
    vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
    vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);
    settings = await import("@/lib/db/settings");
    registry = await import("@/lib/archive/registry");
    ({ db } = await import("@/lib/db/client"));
    personId = (await import("@/lib/db/people")).defaultPersonId();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the defaults when nothing is stored", () => {
    settings.resetTargetRules(personId);
    expect(settings.getTargetRules(personId)).toEqual(DEFAULT_TARGET_RULES);
  });

  it("round-trips a normalized rule set", () => {
    settings.setTargetRules(personId, {
      amberOver: 0.1,
      redAt: 0.1,
      tolerance: 0.2,
      sugarTolerance: 0.25,
      overrides: { NA: 1800, SUGAR: 40 },
    });

    expect(settings.getTargetRules(personId)).toEqual({
      amberOver: 0.1,
      redAt: 0.1,
      tolerance: 0.2,
      sugarTolerance: 0.25,
      overrides: { NA: 1800, SUGAR: 40 },
    });
  });

  it("falls back to the defaults when the stored row is not valid JSON", () => {
    db.prepare(
      `INSERT INTO person_settings (person_id, key, value, updated_at)
       VALUES (?, 'target_rules', '{not json', ?)
       ON CONFLICT(person_id, key) DO UPDATE SET value = excluded.value`,
    ).run(personId, new Date().toISOString());

    expect(settings.getTargetRules(personId)).toEqual(DEFAULT_TARGET_RULES);
  });

  it("reset removes the row", () => {
    settings.setTargetRules(personId, { ...DEFAULT_TARGET_RULES, amberOver: 0.15 });
    settings.resetTargetRules(personId);
    expect(settings.getTargetRules(personId)).toEqual(DEFAULT_TARGET_RULES);
  });

  it("lets a person archive restore the setting", () => {
    expect(registry.IMPORTABLE_PERSON_SETTINGS.has("target_rules")).toBe(true);
    expect(registry.IMPORTABLE_SETTINGS.has("target_rules")).toBe(false);
  });
});
