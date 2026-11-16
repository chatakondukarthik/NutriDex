"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPlanEntryAction,
  copyPlanDayAction,
  copyPlanWeekAction,
  movePlanEntryAction,
  removePlanEntryAction,
  updatePlanEntryQuantityAction,
} from "@/app/actions";
import { CopyIcon, GripIcon } from "@/components/icons";
import { NutrientBar } from "@/components/nutrient-bar";
import { PlanItemSheet, type SheetItem } from "@/components/plan-item-sheet";
import { fmt, fmtMass } from "@/lib/format";
import { toGrams, unitsFor, parseUnitKey } from "@/lib/nutrition/units";
import type { Rollup } from "@/lib/nutrition/engine";
import { type Food } from "@/lib/nutrition/types";
import {
  SLOTS,
  SLOT_LABELS,
  addDays,
  dayOfMonth,
  dayRollup,
  entriesForDay,
  entryRollup,
  versionName,
  weekdayShort,
  weekDays,
  entryQty,
  weekStart,
  type PlanEntry,
  type PlanRecipeOption,
  type Slot,
} from "@/lib/plan";
import {
  GUIDANCE_GROUPS,
  assessDay,
  assessWeek,
  type Assessment,
  type GuidanceRole,
  type Target,
} from "@/lib/targets";

interface PlanBoardProps {
  week: string;
  today: string;
  foods: Food[];
  recipes: PlanRecipeOption[];
  entries: PlanEntry[];
  targets: Target[];
  profileIsDefault: boolean;
}

/**
 * What the palette currently holds.
 *
 * The quantity travels with the selection so that copying a placed item
 * can seed the palette with the same portion instead of a default one.
 */
type Selection =
  | { kind: "food"; id: string; grams: number }
  | { kind: "recipe"; versionId: string; servings: number };

/** What is being dragged: something new, or something already placed. */
type DragPayload =
  | { kind: "palette"; selection: Selection }
  | { kind: "entry"; id: string };

/**
 * A private drag type, so a drag from another tab or app is ignored
 * instead of being half-understood. `text/plain` is still written because
 * some browsers refuse to start a drag without it.
 */
const DRAG_MIME = "application/x-nutriplan";

/** Default amounts for a tap-to-add: a sensible portion, editable in place. */
const DEFAULT_FOOD_GRAMS = 100;
const DEFAULT_RECIPE_SERVINGS = 1;

type Period = "day" | "week";

export function PlanBoard({
  week,
  today,
  foods,
  recipes,
  entries: initialEntries,
  targets,
  profileIsDefault,
}: PlanBoardProps) {
  const [entries, setEntries] = useState<PlanEntry[]>(initialEntries);
  const router = useRouter();
  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"food" | "recipe">("recipe");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [period, setPeriod] = useState<Period>("day");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(
    weekDays(week).includes(today) ? today : week,
  );
  const [error, setError] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const dragRef = useRef<DragPayload | null>(null);
  const paletteRef = useRef<HTMLElement | null>(null);

  /**
   * Which version of each recipe the palette offers.
   *
   * Every version is listed, not only the current one, because a plan may
   * deliberately repeat an older version. The current version is the
   * default, which is what most placements want.
   */
  const [versionChoice, setVersionChoice] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const option of recipes) {
      if (!initial[option.recipeId] || option.isCurrent) {
        initial[option.recipeId] = option.versionId;
      }
    }
    return initial;
  });

  const days = useMemo(() => weekDays(week), [week]);

  const foodById = useMemo(() => new Map(foods.map((food) => [food.id, food])), [foods]);
  const recipeByVersion = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.versionId, recipe])),
    [recipes],
  );
  const targetByCode = useMemo(
    () => new Map(targets.map((target) => [target.code, target])),
    [targets],
  );

  const rollupsByDay = useMemo(() => {
    const map = new Map<string, Rollup>();
    for (const day of days) {
      map.set(day, dayRollup(entriesForDay(entries, day), foodById, recipeByVersion));
    }
    return map;
  }, [days, entries, foodById, recipeByVersion]);

  const entryKcal = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const entry of entries) {
      const result = entryRollup(entry, foodById, recipeByVersion);
      map.set(entry.id, result?.totals.ENERC_KCAL ?? null);
    }
    return map;
  }, [entries, foodById, recipeByVersion]);

  const sheetItems: SheetItem[] = useMemo(() => {
    const source = period === "week" ? entries : entriesForDay(entries, selectedDay);
    return source.map((entry) => {
      const roll = entryRollup(entry, foodById, recipeByVersion);
      const slotLabel = SLOT_LABELS[entry.slot as keyof typeof SLOT_LABELS] ?? entry.slot;
      return {
        id: entry.id,
        name: entryName(entry, foodById, recipeByVersion),
        qty: entryQty(entry),
        slot: entry.slot,
        slotLabel:
          period === "week"
            ? `${slotLabel} · ${weekdayShort(entry.day)} ${dayOfMonth(entry.day)}`
            : slotLabel,
        rollup: roll,
      };
    });
  }, [entries, selectedDay, foodById, recipeByVersion, period]);

  const paletteFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter(
      (food) =>
        food.name.toLowerCase().includes(q) ||
        food.aliases.some((alias) => alias.toLowerCase().includes(q)),
    );
  }, [foods, query]);

  const recipeGroups = useMemo(() => {
    const byRecipe = new Map<string, PlanRecipeOption[]>();
    for (const option of recipes) {
      const list = byRecipe.get(option.recipeId);
      if (list) list.push(option);
      else byRecipe.set(option.recipeId, [option]);
    }

    return [...byRecipe.entries()].map(([recipeId, versions]) => {
      const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
      return {
        recipeId,
        name: ordered[0].name,
        versions: ordered,
        current: ordered.find((version) => version.isCurrent) ?? ordered[0],
      };
    });
  }, [recipes]);

  const paletteGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipeGroups;
    return recipeGroups.filter((group) => group.name.toLowerCase().includes(q));
  }, [recipeGroups, query]);

  const selectedRollup = rollupsByDay.get(selectedDay) ?? null;
  const selectedEntries = entriesForDay(entries, selectedDay);

  /**
   * The panel judges the window it is showing.
   *
   * A day can only answer for energy and protein; the week is where the
   * reference intakes actually live, so the week view judges everything.
   */
  const assessments = useMemo(() => {
    if (period === "day") {
      return assessDay(rollupsByDay.get(selectedDay) ?? dayRollup([], foodById, recipeByVersion), targets);
    }
    const weekRollups = days
      .map((day) => rollupsByDay.get(day))
      .filter((rollup): rollup is Rollup => rollup != null);
    return assessWeek(weekRollups, targets);
  }, [period, selectedDay, rollupsByDay, days, targets, foodById, recipeByVersion]);

  const energy = assessments.find((entry) => entry.code === "ENERC_KCAL") ?? null;
  const periodItems = entries.filter((entry) => days.includes(entry.day));

  function describe(selection: Selection): string {
    if (selection.kind === "food") {
      const food = foodById.get(selection.id);
      return `${food?.name ?? "Food"} · ${fmtMass(selection.grams)} g`;
    }
    const recipe = recipeByVersion.get(selection.versionId);
    return `${recipe ? versionName(recipe) : "Recipe"} · ${servingsLabel(
      selection.servings,
    )}`;
  }

  function selectionTitle(selection: Selection): string {
    if (selection.kind === "food") {
      return foodById.get(selection.id)?.name ?? "Food";
    }
    const recipe = recipeByVersion.get(selection.versionId);
    return recipe ? versionName(recipe) : "Recipe";
  }

  function place(day: string, slot: Slot, picked: Selection) {
    setError(null);
    setSelectedDay(day);

    const base = {
      planId: "pending",
      day,
      slot,
      position: entries.filter((entry) => entry.day === day && entry.slot === slot).length,
      amount: null,
      unit: null,
    };

    const optimistic: PlanEntry =
      picked.kind === "food"
        ? {
            ...base,
            id: `pending-${crypto.randomUUID()}`,
            foodId: picked.id,
            recipeVersionId: null,
            grams: picked.grams,
            servings: null,
          }
        : {
            ...base,
            id: `pending-${crypto.randomUUID()}`,
            foodId: null,
            recipeVersionId: picked.versionId,
            grams: null,
            servings: picked.servings,
          };

    setEntries((current) => [...current, optimistic]);

    startTransition(async () => {
      const response = await addPlanEntryAction({
        week,
        day,
        slot,
        foodId: picked.kind === "food" ? picked.id : null,
        recipeVersionId: picked.kind === "recipe" ? picked.versionId : null,
        grams: picked.kind === "food" ? picked.grams : null,
        servings: picked.kind === "recipe" ? picked.servings : null,
      });

      if (!response.ok || !response.entry) {
        setEntries((current) => current.filter((entry) => entry.id !== optimistic.id));
        setError(response.message ?? "Could not add that item.");
        return;
      }

      const saved = response.entry;
      setEntries((current) =>
        current.map((entry) => (entry.id === optimistic.id ? saved : entry)),
      );
    });
  }

  /** Keep amount + unit as the user-facing quantity; grams is derived. */
  function setFoodUnit(entry: PlanEntry, unitKey: string) {
    if (!entry.foodId) return;
    const food = foodById.get(entry.foodId);
    if (!food) return;
    const amount = entry.amount ?? entry.grams ?? 0;
    const parsed = parseUnitKey(unitKey);
    const converted = toGrams(food, { amount, unit: parsed.unit, portionLabel: parsed.portionLabel });
    if (!converted.ok) {
      setError(converted.reason);
      return;
    }
    setError(null);

    const previous = entry;
    const optimistic: PlanEntry = { ...entry, grams: converted.grams, amount, unit: unitKey };
    setEntries((current) => current.map((item) => (item.id === entry.id ? optimistic : item)));

    startTransition(async () => {
      const response = await updatePlanEntryQuantityAction(entry.id, {
        grams: converted.grams,
        amount,
        unit: unitKey,
      });
      if (!response.ok) {
        setEntries((current) =>
          current.map((item) => (item.id === previous.id ? previous : item)),
        );
        setError(response.message ?? "Could not update that item.");
      }
    });
  }

  /** Keep amount + unit as the user-facing quantity; grams is derived. */
  function setFoodQuantity(entry: PlanEntry, value: number) {
    if (!entry.foodId) return setQuantity(entry, value);
    const food = foodById.get(entry.foodId);
    if (!food) return;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    const parsed = parseUnitKey(entry.unit ?? "g");
    const converted = toGrams(food, { amount: value, unit: parsed.unit, portionLabel: parsed.portionLabel });
    if (!converted.ok) {
      setError(converted.reason);
      return;
    }
    setError(null);

    const previous = entry;
    const optimistic: PlanEntry = { ...entry, grams: converted.grams, amount: value, unit: entry.unit ?? "g" };
    setEntries((current) => current.map((item) => (item.id === entry.id ? optimistic : item)));

    startTransition(async () => {
      const response = await updatePlanEntryQuantityAction(entry.id, {
        grams: converted.grams,
        amount: value,
        unit: entry.unit ?? "g",
      });
      if (!response.ok) {
        setEntries((current) =>
          current.map((item) => (item.id === previous.id ? previous : item)),
        );
        setError(response.message ?? "Could not update that item.");
      }
    });
  }

  /** Move a placed item to another day or slot. The item itself is unchanged. */
  function move(entry: PlanEntry, day: string, slot: Slot) {
    if (entry.day === day && entry.slot === slot) return;

    setError(null);
    setSelectedDay(day);

    const previous = entry;
    const position =
      entries
        .filter((item) => item.day === day && item.slot === slot && item.id !== entry.id)
        .reduce((max, item) => Math.max(max, item.position), -1) + 1;

    setEntries((current) =>
      current.map((item) =>
        item.id === entry.id ? { ...item, day, slot, position } : item,
      ),
    );

    startTransition(async () => {
      const response = await movePlanEntryAction({ week, id: entry.id, day, slot });
      if (!response.ok) {
        setEntries((current) =>
          current.map((item) => (item.id === previous.id ? previous : item)),
        );
        setError(response.message ?? "Could not move that item.");
      }
    });
  }

  function setQuantity(entry: PlanEntry, value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    setError(null);

    const previous = entry;
    const optimistic: PlanEntry = entry.foodId
      ? { ...entry, grams: value, amount: value, unit: "g" }
      : { ...entry, servings: value };

    setEntries((current) => current.map((item) => (item.id === entry.id ? optimistic : item)));

    startTransition(async () => {
      const response = await updatePlanEntryQuantityAction(
        entry.id,
        entry.foodId ? { grams: value, amount: value, unit: "g" } : { servings: value },
      );

      if (!response.ok) {
        setEntries((current) =>
          current.map((item) => (item.id === previous.id ? previous : item)),
        );
        setError(response.message ?? "Could not update that item.");
      }
    });
  }

  function remove(entry: PlanEntry) {
    setError(null);
    setEntries((current) => current.filter((item) => item.id !== entry.id));

    startTransition(async () => {
      await removePlanEntryAction(entry.id);
    });
  }

  /**
   * Put an item already on the board back in the palette.
   *
   * This is the tap-based equivalent of an Alt-drag: the selection keeps
   * the item's quantity, so placing it elsewhere is a duplicate rather
   * than a re-entry.
   */
  function copyToPalette(entry: PlanEntry) {
    const picked = selectionOf(entry);
    if (!picked) return;

    setError(null);
    setSelection(picked);
    setSelectedDay(entry.day);
    setTab(picked.kind === "food" ? "food" : "recipe");

    if (picked.kind === "recipe") {
      const recipe = recipeByVersion.get(picked.versionId);
      if (recipe) {
        setVersionChoice((current) => ({ ...current, [recipe.recipeId]: recipe.versionId }));
      }
    }

    paletteRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function startPaletteDrag(event: React.DragEvent, picked: Selection) {
    const payload: DragPayload = { kind: "palette", selection: picked };
    dragRef.current = payload;
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", describe(picked));
    event.dataTransfer.effectAllowed = "copy";
    dragGhost(event, selectionTitle(picked), describe(picked));
  }

  function startEntryDrag(event: React.DragEvent, entry: PlanEntry) {
    const payload: DragPayload = { kind: "entry", id: entry.id };
    dragRef.current = payload;
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", entryName(entry, foodById, recipeByVersion));
    event.dataTransfer.effectAllowed = "copyMove";
    dragGhost(
      event,
      entryName(entry, foodById, recipeByVersion),
      `${quantityLabel(entry)} · ${fmt(entryKcal.get(entry.id) ?? null, 0)} kcal`,
    );
  }

  function onDragOver(event: React.DragEvent, dropKey: string) {
    event.preventDefault();
    // A placed item moves by default; Alt turns the same drag into a copy.
    event.dataTransfer.dropEffect =
      dragRef.current?.kind === "entry" && !event.altKey ? "move" : "copy";
    if (dragOver !== dropKey) setDragOver(dropKey);
  }

  function onDrop(event: React.DragEvent, day: string, slot: Slot) {
    event.preventDefault();
    setDragOver(null);

    const payload = readPayload(event, dragRef);
    dragRef.current = null;
    if (!payload) return;

    if (payload.kind === "palette") {
      place(day, slot, payload.selection);
      return;
    }

    const entry = entries.find((item) => item.id === payload.id);
    if (!entry) return;

    if (event.altKey) {
      const picked = selectionOf(entry);
      if (picked) place(day, slot, picked);
      return;
    }

    move(entry, day, slot);
  }

  /**
   * One day column.
   *
   * Defined once and used twice: the seven-column week on wide screens,
   * and a single day on small ones. One renderer means the two layouts
   * cannot drift apart. The summary header is optional because the mobile
   * day picker already shows the same date and total directly above.
   */
  function renderDay(day: string, showHeader = true) {
    const rollup = rollupsByDay.get(day);
    const kcal = rollup?.totals.ENERC_KCAL ?? null;
    const dayTarget = targetByCode.get("ENERC_KCAL");
    const pct =
      kcal != null && dayTarget ? Math.min(100, (kcal / dayTarget.value) * 100) : 0;
    const dayEntries = entriesForDay(entries, day);
    const isToday = day === today;

    return (
      <div
        key={day}
        className={`flex flex-col rounded-xl border bg-surface transition ${
          selectedDay === day ? "border-accent/40 ring-2 ring-accent/10" : "border-line"
        }`}
      >
        {showHeader && (
          <button
            type="button"
            onClick={() => setSelectedDay(day)}
            className="rounded-t-xl px-2.5 pb-2 pt-2 text-left transition hover:bg-surface-2"
          >
            <div className="flex items-baseline justify-between gap-1">
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  isToday ? "text-accent" : "text-ink/50"
                }`}
              >
                {weekdayShort(day)}
              </span>
              <span className="tabular text-[11px] text-ink/35">{dayOfMonth(day)}</span>
            </div>

            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="tabular text-sm font-semibold">
                {kcal == null ? "—" : fmt(kcal, 0)}
              </span>
              <span className="text-[10px] text-ink/35">kcal</span>
            </div>

            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10">
              {kcal != null && dayTarget && (
                <div
                  className={`bar-fill h-full rounded-full ${
                    kcal / dayTarget.value >= 1.2
                      ? "bg-danger"
                      : kcal / dayTarget.value > 1
                        ? "bg-warn"
                        : "bg-accent"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>

            <div className="mt-1 text-[10px] text-ink/35">
              {dayEntries.length === 0
                ? "nothing planned"
                : `${dayEntries.length} ${dayEntries.length === 1 ? "item" : "items"}`}
            </div>
          </button>
        )}

        <div className={`flex max-h-[280px] min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 ${showHeader ? "pt-0" : ""}`}>
          {SLOTS.map((slot) => {
            const slotEntries = dayEntries.filter((entry) => entry.slot === slot);
            const dropKey = `${day}:${slot}`;
            const isOver = dragOver === dropKey;

            return (
              <div
                key={slot}
                onDragOver={(event) => onDragOver(event, dropKey)}
                onDragLeave={() =>
                  setDragOver((current) => (current === dropKey ? null : current))
                }
                onDrop={(event) => onDrop(event, day, slot)}
                className={`rounded-lg border border-dashed p-1 transition ${
                  isOver ? "border-accent/60 bg-accent/[0.06]" : "border-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/30">
                    {SLOT_LABELS[slot]}
                  </span>
                  {selection && (
                    <button
                      type="button"
                      onClick={() => place(day, slot, selection)}
                      aria-label={`Add ${describe(selection)} to ${
                        SLOT_LABELS[slot]
                      } on ${weekdayShort(day)}`}
                      className="grid h-6 w-6 place-items-center rounded text-[13px] leading-none text-accent transition hover:bg-accent/10 lg:h-4 lg:w-4 lg:text-[11px]"
                    >
                      +
                    </button>
                  )}
                </div>

                {slotEntries.length === 0 ? (
                  selection ? (
                    <button
                      type="button"
                      onClick={() => place(day, slot, selection)}
                      className="mt-0.5 w-full rounded border border-dashed border-line py-1 text-[10px] text-ink/35 transition hover:border-accent/40 hover:text-accent"
                    >
                      Place here
                    </button>
                  ) : (
                    <p className="py-1 text-center text-[10px] text-ink/20">—</p>
                  )
                ) : (
                  <ul className="mt-0.5 space-y-1">
                    {slotEntries.map((entry) => (
                      <PlanEntryRow
                        key={entry.id}
                        entry={entry}
                        name={entryName(entry, foodById, recipeByVersion)}
                        kcal={entryKcal.get(entry.id) ?? null}
                        food={entry.foodId ? foodById.get(entry.foodId) ?? null : null}
                        units={entry.foodId && foodById.get(entry.foodId) ? unitsFor(foodById.get(entry.foodId)!) : null}
                        onQuantity={(value) => setFoodQuantity(entry, value)}
                        onUnitChange={(unitKey) => setFoodUnit(entry, unitKey)}
                        onCopy={() => copyToPalette(entry)}
                        onRemove={() => remove(entry)}
                        onDragStart={(event) => startEntryDrag(event, entry)}
                        onDragEnd={() => {
                          dragRef.current = null;
                          setDragOver(null);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const weekLabel = `${shortDate(week)} – ${shortDate(addDays(week, 6), true)}`;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-xs text-ink/45">{weekLabel}</p>
              <input
                type="date"
                value={week}
                onChange={(e) => {
                  if (e.target.value) router.push(`/plan?week=${weekStart(e.target.value)}`);
                }}
                className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={`/plan?week=${addDays(week, -7)}`}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-ink/5"
            >
              ← Previous
            </Link>
            <Link
              href="/plan"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-ink/5"
            >
              This week
            </Link>
            <Link
              href={`/plan?week=${addDays(week, 7)}`}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-ink/5"
            >
              Next →
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await copyPlanWeekAction(week, addDays(week, 7));
                  if (result.ok) router.push(`/plan?week=${addDays(week, 7)}`);
                  else setError(result.message ?? "Could not copy week.");
                })
              }
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-ink/5 disabled:opacity-50"
            >
              Copy to next week
            </button>
          </div>
        </div>

        {profileIsDefault && (
          <p className="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-[11px] text-warn-ink">
            Targets use the default profile (a 30-year-old woman, moderate activity).{" "}
            <Link href="/profile" className="font-medium underline underline-offset-2">
              Set your own numbers
            </Link>
            .
          </p>
        )}

        {error && (
          <p className="mb-3 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger-ink">
            {error}
          </p>
        )}

        {/* ---- Palette --------------------------------------------------- */}
        <section
          ref={paletteRef}
          className="rounded-2xl border border-line bg-surface p-4 shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-ink/[0.06] p-0.5">
              {(
                [
                  { key: "recipe", label: `Recipes (${recipeGroups.length})` },
                  { key: "food", label: `Foods (${foods.length})` },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTab(option.key)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    tab === option.key
                      ? "bg-surface text-accent shadow-sm"
                      : "text-ink/45 hover:text-ink/70"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "recipe" ? "Search recipes…" : "paneer, palak, dal…"}
              className="w-full max-w-xs rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs outline-none placeholder:text-ink/30 focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
            />
          </div>

          <p className="mt-2 text-[11px] text-ink/40">
            {selection
              ? `Selected: ${describe(selection)} — tap a slot, or drag it there.`
              : "Pick an item, then tap a slot. Drag a placed item by its handle to move it, or hold Alt while dropping to copy."}
          </p>

          <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {tab === "recipe"
              ? paletteGroups.map((group) => {
                  const chosen =
                    group.versions.find(
                      (version) => version.versionId === versionChoice[group.recipeId],
                    ) ?? group.current;
                  const picked: Selection = {
                    kind: "recipe",
                    versionId: chosen.versionId,
                    servings: DEFAULT_RECIPE_SERVINGS,
                  };
                  const active =
                    selection?.kind === "recipe" &&
                    selection.versionId === chosen.versionId;

                  return (
                    <div
                      key={group.recipeId}
                      className={`w-[212px] rounded-xl border p-1.5 transition ${
                        active
                          ? "border-accent/50 bg-accent/[0.07]"
                          : "border-line bg-surface-2"
                      }`}
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => startPaletteDrag(event, picked)}
                        onDragEnd={() => {
                          dragRef.current = null;
                          setDragOver(null);
                        }}
                        onClick={() => setSelection(active ? null : picked)}
                        className="block w-full cursor-grab px-1 pt-0.5 text-left active:cursor-grabbing"
                      >
                        <span className="block truncate text-xs font-medium">{group.name}</span>
                        <span className="block truncate text-[10px] text-ink/40">
                          {group.versions.length > 1 ? `v${chosen.versionNo} · ` : ""}
                          {chosen.label ? `${chosen.label} · ` : ""}
                          {fmt(chosen.perServing.totals.ENERC_KCAL, 0)} kcal / serving
                        </span>
                      </button>

                      {group.versions.length > 1 && (
                        <label className="mt-1 block">
                          <span className="sr-only">Version of {group.name}</span>
                          <select
                            value={chosen.versionId}
                            onChange={(event) => {
                              const versionId = event.target.value;
                              setVersionChoice((current) => ({
                                ...current,
                                [group.recipeId]: versionId,
                              }));
                              setSelection({
                                kind: "recipe",
                                versionId,
                                servings: DEFAULT_RECIPE_SERVINGS,
                              });
                            }}
                            className="w-full rounded-md border border-line bg-surface px-1.5 py-1 text-[10px] text-ink/60 outline-none focus:border-accent/50"
                          >
                            {group.versions.map((version) => (
                              <option key={version.versionId} value={version.versionId}>
                                {versionOptionLabel(version)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })
              : paletteFoods.map((food) => {
                  const picked: Selection = {
                    kind: "food",
                    id: food.id,
                    grams: DEFAULT_FOOD_GRAMS,
                  };
                  const active = selection?.kind === "food" && selection.id === food.id;

                  return (
                    <button
                      key={food.id}
                      type="button"
                      draggable
                      onDragStart={(event) => startPaletteDrag(event, picked)}
                      onDragEnd={() => {
                        dragRef.current = null;
                        setDragOver(null);
                      }}
                      onClick={() => setSelection(active ? null : picked)}
                      className={`max-w-[230px] cursor-grab rounded-lg border px-2.5 py-1.5 text-left transition active:cursor-grabbing ${
                        active
                          ? "border-accent/50 bg-accent/[0.07]"
                          : "border-line bg-surface-2 hover:border-line-strong"
                      }`}
                    >
                      <span className="block truncate text-xs font-medium">{food.name}</span>
                      <span className="block truncate text-[10px] text-ink/40">
                        {fmt(food.nutrients.ENERC_KCAL.amount, 0)} kcal / 100 g
                      </span>
                    </button>
                  );
                })}
          </div>

          {selection && (
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="mt-2 text-[11px] font-medium text-ink/40 underline underline-offset-2 hover:text-ink/60"
            >
              Clear selection
            </button>
          )}
        </section>

        {/* ---- Week ------------------------------------------------------ */}
        <section className="mt-4 pb-1">
          {/* Small/medium screens get one day at a time. Seven columns
              below 1280px starves each day card (see the xl note
              below). */}
          <div className="xl:hidden">
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {days.map((day) => {
                const kcal = rollupsByDay.get(day)?.totals.ENERC_KCAL ?? null;
                const count = entriesForDay(entries, day).length;
                const active = selectedDay === day;
                const isToday = day === today;

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-pressed={active}
                    className={`w-[74px] shrink-0 rounded-xl border px-2 py-1.5 text-left transition ${
                      active ? "border-accent/40 bg-accent/[0.07]" : "border-line bg-surface"
                    }`}
                  >
                    <span
                      className={`block text-[9px] font-semibold uppercase tracking-wider ${
                        isToday ? "text-accent" : "text-ink/40"
                      }`}
                    >
                      {weekdayShort(day)}
                    </span>
                    <span className="tabular block text-sm font-semibold leading-tight">
                      {dayOfMonth(day)}
                    </span>
                    <span className="tabular block text-[10px] text-ink/40">
                      {kcal == null ? "—" : `${fmt(kcal, 0)} kcal`}
                    </span>
                    <span className="block truncate text-[9px] text-ink/30">
                      {count === 0 ? "empty" : `${count} ${count === 1 ? "item" : "items"}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedEntries.length === 0 && entries.length === 0 && (
              <p className="mb-2 rounded-control bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
                This week is empty. Search for a food or recipe on the left and
                tap a slot to add it. Dragging also works.
              </p>
            )}
            {/* Centered measure: at 1024–1279px this single-day view
                spans ~1200px, which would stretch the quantity input
                absurdly wide. */}
            <div className="mx-auto mt-2 max-w-2xl">{renderDay(selectedDay, false)}</div>
          </div>

          {/* Full week needs ~1280px for seven readable columns; below
              that the columns starve the entry rows (name squashed to
              ~10px at 1024), so the single-day view takes over until
              xl. */}
          <div className="hidden xl:block">
            <div className="grid grid-cols-7 gap-2">
              {days.map((day) => renderDay(day))}
            </div>
          </div>
        </section>

        {/* ---- Selected day + nutrition --------------------------------- */}
        <section className="mt-5">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {weekdayShort(selectedDay)} {dayOfMonth(selectedDay)}
              </h2>
              <span className="text-[11px] text-ink/40">
                {selectedEntries.length}{" "}
                {selectedEntries.length === 1 ? "item" : "items"}
              </span>
              <div className="flex items-center gap-1">
                <select
                  value={copyTarget}
                  onChange={(e) => setCopyTarget(e.target.value)}
                  className="rounded-md border border-line bg-bg px-1.5 py-1 text-[11px]"
                >
                  <option value="">Copy day to…</option>
                  {days
                    .filter((d) => d !== selectedDay)
                    .map((d) => (
                      <option key={d} value={d}>
                        {weekdayShort(d)} {dayOfMonth(d)}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!copyTarget || pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await copyPlanDayAction(selectedDay, copyTarget);
                      if (!result.ok) setError(result.message ?? "Could not copy.");
                      else {
                        setError(null);
                        setCopyTarget("");
                        router.refresh();
                      }
                    })
                  }
                  className="rounded-md border border-line px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                >
                  Copy
                </button>
              </div>
            </div>

            {selectedEntries.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-ink/40">
                Nothing planned for this day yet. Pick a recipe or food above and place it in a
                slot.
              </p>
            ) : (
              <div className="mt-3">
                <PlanItemSheet
                  items={sheetItems}
                  period={period}
                  dayLabel={
                    period === "day"
                      ? `${weekdayShort(selectedDay)} ${dayOfMonth(selectedDay)}`
                      : `Week of ${weekdayShort(week)} ${dayOfMonth(week)}`
                  }
                  onCopy={(id) => {
                    const entry = entries.find((e) => e.id === id);
                    if (entry) copyToPalette(entry);
                  }}
                  onRemove={(id) => {
                    const entry = entries.find((e) => e.id === id);
                    if (entry) remove(entry);
                  }}
                />
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* ---- Anchor pane: energy + protein (the only daily judgements) ---- */}
          <section className="flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {period === "day" ? "Day nutrition" : "Week nutrition"}
                </h2>
                <p className="mt-0.5 text-[11px] text-ink/40">
                  {period === "day"
                    ? `${weekdayShort(selectedDay)} ${dayOfMonth(selectedDay)} · ${selectedEntries.length} ${selectedEntries.length === 1 ? "item" : "items"}`
                    : `${periodItems.length} ${periodItems.length === 1 ? "item" : "items"} across 7 days`}
                </p>
              </div>
              <PeriodToggle period={period} onChange={setPeriod} />
            </div>

            {energy == null || energy.actual == null ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-ink/40">
                {period === "day" ? "Nothing planned yet." : "Nothing planned this week."}
              </p>
            ) : (
              <>
                <div className="mt-3">
                  <div className="tabular text-3xl font-semibold leading-none">
                    {fmt(energy.actual, 0)}
                    <span className="ml-1 text-sm font-normal text-ink/40">kcal</span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink/40">
                    of {fmt(energy.target, 0)} kcal {period === "day" ? "target" : "weekly target"}
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className={`bar-fill h-full rounded-full ${
                      (energy.ratio ?? 0) >= 1.2
                        ? "bg-danger"
                        : (energy.ratio ?? 0) > 1
                          ? "bg-warn"
                          : energy.status === "high"
                            ? "bg-warn"
                            : "bg-accent"
                    }`}
                    style={{ width: `${Math.min(100, (energy.ratio ?? 0) * 100)}%` }}
                  />
                </div>

                <div className="mt-4">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                    Protein
                  </h3>
                  {assessments.filter((a) => a.code === "PROCNT").map((entry) => (
                    <div key={entry.code} className="mt-2">
                      <NutrientBar code="PROCNT" assessment={entry} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ---- Weekly groups pane: judge everything that isn't an anchor ---- */}
          <section className="flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h3 className="text-sm font-semibold">
              {period === "day" ? "Rest of the week" : "Week totals"}
            </h3>
            <p className="mt-0.5 text-[10px] leading-snug text-ink/35">
              {period === "day"
                ? "In the day view these are data, not verdicts — the week judges them."
                : "Seven days of planned food, judged."}
            </p>
            <div className="mt-2 max-h-96 flex-1 space-y-4 overflow-y-auto pr-1">
              {GUIDANCE_GROUPS.filter((group) => group.role !== "daily-anchor").map((group) => {
                const items = assessments.filter((entry) => entry.role === group.role);
                if (items.length === 0) return null;
                const summary = groupSummary(items, period, group.role);
                return (
                  <div key={group.role}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                        {group.label}
                      </h4>
                      {summary && (
                        <span className="tabular text-[9px] text-ink/35">{summary}</span>
                      )}
                    </div>
                    <div className="mt-2 space-y-2">
                      {items.map((entry) => (
                        <NutrientBar key={entry.code} code={entry.code} assessment={entry} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="mx-auto max-w-7xl pb-8 pt-4">
          <p className="text-[11px] leading-relaxed text-ink/35">
            {pending ? "" : "✓ All changes saved"}
            {pending ? " — saving… · " : " · "}
            A planned recipe is pinned to the version you added. Editing the recipe later creates
            a new version and leaves this week alone. Targets are estimates from your profile and
            reference values, not medical advice.
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function PeriodToggle({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-ink/[0.06] p-0.5">
      {(
        [
          { key: "day", label: "Day" },
          { key: "week", label: "Week" },
        ] as const
      ).map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={period === option.key}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
            period === option.key
              ? "bg-surface text-accent shadow-sm"
              : "text-ink/45 hover:text-ink/70"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PlanEntryRow({
  entry,
  name,
  kcal,
  food,
  units,
  onQuantity,
  onUnitChange,
  onCopy,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  entry: PlanEntry;
  name: string;
  kcal: number | null;
  food: Food | null;
  /** Universal + portion unit options for foods; null for recipes. */
  units: { value: string; label: string }[] | null;
  onQuantity: (value: number) => void;
  onUnitChange: (unitKey: string) => void;
  onCopy: () => void;
  onRemove: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const value = entry.foodId ? (entry.amount ?? entry.grams ?? 0) : entry.servings ?? 0;
  const unitKey = entry.unit ?? "g";

  return (
    <li className="animate-pop group rounded-md bg-surface-2 px-1.5 py-1 transition hover:bg-ink/[0.05]">
      <div className="flex items-start gap-0.5">
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-label={`Move ${name}. Hold Alt while dropping to copy.`}
          title="Drag to move · hold Alt to copy"
          className="-ml-0.5 mt-0.5 grid h-4 w-3.5 shrink-0 cursor-grab place-items-center rounded text-ink/25 transition hover:text-ink/60 active:cursor-grabbing"
        >
          <GripIcon className="h-3 w-3" />
        </button>

        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
          {name}
        </span>

        <span className="shrink-0 tabular text-[10px] leading-none text-ink/45">
          {fmt(kcal, 0)} kcal
        </span>

        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${name} to the palette`}
          title="Copy to the palette, keeping this quantity"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink/30 transition hover:bg-ink/5 hover:text-ink/70 lg:h-4 lg:w-4 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
        >
          <CopyIcon className="h-3 w-3" />
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[13px] leading-none text-ink/30 transition hover:bg-ink/5 hover:text-ink/60 lg:h-4 lg:w-4 lg:text-[11px]"
        >
          ×
        </button>
      </div>

      {/*
        Quantity + unit. The week column is only ~108–144px of content
        wide (7 columns inside max-w-7xl), so a fixed side-by-side row
        starves the input down to ~20–56px. Instead the input declares a
        72px floor: with the 64px select that needs 140px, so on narrow
        columns the select wraps onto its own line and the input takes
        the full width (94–130px); on wide columns they sit side by
        side (input ≥76px). Pure flex-wrap — adapts to the real column,
        not a guessed breakpoint.
      */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <input
          key={`${entry.id}:${value}:${unitKey}`}
          type="number"
          min="0"
          step="any"
          defaultValue={value}
          aria-label={`${entry.foodId ? "Quantity" : "Servings"} of ${name}`}
          onBlur={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next) || next <= 0) {
              event.target.value = String(value);
              return;
            }
            if (next !== value) onQuantity(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          className="tabular h-6 min-w-[4.5rem] flex-1 rounded-md border border-line bg-surface px-1.5 text-[11px] outline-none focus:border-accent/50"
        />
        {units ? (
          <select
            value={unitKey}
            onChange={(event) => onUnitChange(event.target.value)}
            aria-label={`Unit for ${name}`}
            className="h-6 w-16 shrink-0 rounded-md border border-line bg-surface px-1 text-[11px] outline-none focus:border-accent/50"
          >
            {units.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="h-6 w-10 text-[10px] leading-6 text-ink/35">srv</span>
        )}
      </div>
      {entry.foodId && unitKey !== "g" && (
        <p className="mt-0.5 text-[9px] leading-tight text-ink/35">
          = {fmt(entry.grams ?? 0, 0)} g
          {food && food.densityGPerMl == null && (unitKey === "ml" || unitKey === "l" || unitKey === "cup" || unitKey === "tsp" || unitKey === "tbsp" || unitKey === "fl_oz") && (
            <span className="ml-1 text-warn-ink" title="No density recorded — using an assumed value (edit the food to set a real one)">
              · ≈assumed
            </span>
          )}
        </p>
      )}
    </li>
  );
}

/* --------------------------------------------------------------- helpers */

/**
 * A drag image we control.
 *
 * The browser's default is a snapshot of the dragged element, which
 * renders its rounded corners as an opaque rectangle. A detached, rounded
 * node with the app's own surface colour looks like the thing being
 * carried instead of a cut-out of it.
 */
function dragGhost(event: React.DragEvent, title: string, detail: string) {
  const node = document.createElement("div");
  const heading = document.createElement("span");
  const sub = document.createElement("span");

  heading.textContent = title;
  sub.textContent = detail;

  heading.style.cssText = "display:block;font-weight:600;font-size:12px;line-height:1.3";
  sub.style.cssText = "display:block;font-size:10px;line-height:1.3;opacity:0.55;margin-top:2px";
  node.style.cssText = [
    "position:fixed",
    "top:-1000px",
    "left:-1000px",
    "max-width:240px",
    "padding:7px 11px",
    "border-radius:12px",
    "border:1px solid var(--accent)",
    "background:var(--surface)",
    "color:var(--ink)",
    "box-shadow:0 14px 32px oklch(0 0 0 / 0.22)",
    "font:500 12px/1.3 ui-sans-serif, system-ui, sans-serif",
    "white-space:nowrap",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "pointer-events:none",
  ].join(";");

  node.append(heading, sub);
  document.body.appendChild(node);

  event.dataTransfer.setDragImage(node, 16, 16);
  // The snapshot is taken during this event; the node can go straight after.
  setTimeout(() => node.remove(), 0);
}

function readPayload(
  event: React.DragEvent,
  ref: React.RefObject<DragPayload | null>,
): DragPayload | null {
  if (ref.current) return ref.current;

  const raw = event.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function selectionOf(entry: PlanEntry): Selection | null {
  if (entry.foodId && entry.grams != null) {
    return { kind: "food", id: entry.foodId, grams: entry.grams };
  }
  if (entry.recipeVersionId && entry.servings != null) {
    return { kind: "recipe", versionId: entry.recipeVersionId, servings: entry.servings };
  }
  return null;
}

function versionOptionLabel(option: PlanRecipeOption): string {
  const name = option.label ? `${option.label} · v${option.versionNo}` : `v${option.versionNo}`;
  return option.isCurrent ? `${name} (current)` : name;
}

function servingsLabel(servings: number): string {
  return `${fmt(servings, servings % 1 === 0 ? 0 : 1)} ${
    servings === 1 ? "serving" : "servings"
  }`;
}

const quantityLabel = entryQty;

function entryName(
  entry: PlanEntry,
  foodById: Map<string, Food>,
  recipeByVersion: Map<string, PlanRecipeOption>,
): string {
  if (entry.foodId) return foodById.get(entry.foodId)?.name ?? entry.foodId;
  if (entry.recipeVersionId) {
    const recipe = recipeByVersion.get(entry.recipeVersionId);
    return recipe ? versionName(recipe) : entry.recipeVersionId;
  }
  return "Unknown item";
}

/**
 * A one-line verdict for a guidance group.
 *
 * The day view only counts the anchors: telling someone "3 of 8 vitamins
 * met" on a Tuesday would invent a failure the model does not have.
 */
function groupSummary(
  items: Assessment[],
  period: Period,
  role: GuidanceRole,
): string | null {
  if (period === "day" && role !== "daily-anchor") return null;

  const known = items.filter((entry) => entry.status !== "unknown");
  if (known.length === 0) return "no data";

  const met = known.filter((entry) => entry.status === "met").length;
  const issues = known.filter(
    (entry) => entry.status === "low" || entry.status === "high",
  ).length;

  return issues > 0
    ? `${met}/${known.length} met · ${issues} to check`
    : `${met}/${known.length} met`;
}

function shortDate(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}
