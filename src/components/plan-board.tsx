"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  addPlanEntryAction,
  removePlanEntryAction,
  updatePlanEntryQuantityAction,
} from "@/app/actions";
import { NutrientBar } from "@/components/nutrient-bar";
import { fmt, fmtMass } from "@/lib/format";
import type { Rollup } from "@/lib/nutrition/engine";
import {
  NUTRIENTS,
  NUTRIENT_CODES,
  type Food,
  type NutrientGroup,
} from "@/lib/nutrition/types";
import {
  SLOTS,
  SLOT_LABELS,
  addDays,
  dayOfMonth,
  dayRollup,
  entriesForDay,
  entryRollup,
  weekdayShort,
  weekDays,
  type PlanEntry,
  type PlanRecipeOption,
  type Slot,
} from "@/lib/plan";
import type { Target } from "@/lib/targets";

interface PlanBoardProps {
  week: string;
  today: string;
  foods: Food[];
  recipes: PlanRecipeOption[];
  entries: PlanEntry[];
  targets: Target[];
  profileIsDefault: boolean;
}

type Selection =
  | { kind: "food"; id: string }
  | { kind: "recipe"; versionId: string };

const GROUPS: { key: NutrientGroup; label: string }[] = [
  { key: "macro", label: "Macros" },
  { key: "mineral", label: "Minerals" },
  { key: "vitamin", label: "Vitamins" },
];

/** Default amounts for a tap-to-add: a sensible portion, editable in place. */
const DEFAULT_FOOD_GRAMS = 100;
const DEFAULT_RECIPE_SERVINGS = 1;

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
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"food" | "recipe">("recipe");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(
    weekDays(week).includes(today) ? today : week,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  const paletteFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter(
      (food) =>
        food.name.toLowerCase().includes(q) ||
        food.aliases.some((alias) => alias.toLowerCase().includes(q)),
    );
  }, [foods, query]);

  const paletteRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((recipe) => recipe.name.toLowerCase().includes(q));
  }, [recipes, query]);

  const energyTarget = targetByCode.get("ENERC_KCAL");
  const selectedRollup = rollupsByDay.get(selectedDay) ?? null;
  const selectedEntries = entriesForDay(entries, selectedDay);

  function describe(selection: Selection): string {
    if (selection.kind === "food") {
      const food = foodById.get(selection.id);
      return `${food?.name ?? "Food"} · ${DEFAULT_FOOD_GRAMS} g`;
    }
    const recipe = recipeByVersion.get(selection.versionId);
    return `${recipe?.name ?? "Recipe"} · ${DEFAULT_RECIPE_SERVINGS} serving`;
  }

  function addTo(day: string, slot: Slot, picked: Selection) {
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
            grams: DEFAULT_FOOD_GRAMS,
            servings: null,
          }
        : {
            ...base,
            id: `pending-${crypto.randomUUID()}`,
            foodId: null,
            recipeVersionId: picked.versionId,
            grams: null,
            servings: DEFAULT_RECIPE_SERVINGS,
          };

    setEntries((current) => [...current, optimistic]);

    startTransition(async () => {
      const response = await addPlanEntryAction({
        week,
        day,
        slot,
        foodId: picked.kind === "food" ? picked.id : null,
        recipeVersionId: picked.kind === "recipe" ? picked.versionId : null,
        grams: picked.kind === "food" ? DEFAULT_FOOD_GRAMS : null,
        servings: picked.kind === "recipe" ? DEFAULT_RECIPE_SERVINGS : null,
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

  function setQuantity(entry: PlanEntry, value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    setError(null);

    const previous = entry;
    const optimistic: PlanEntry = entry.foodId
      ? { ...entry, grams: value }
      : { ...entry, servings: value };

    setEntries((current) => current.map((item) => (item.id === entry.id ? optimistic : item)));

    startTransition(async () => {
      const response = await updatePlanEntryQuantityAction(
        entry.id,
        entry.foodId ? { grams: value } : { servings: value },
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

  function onDrop(event: React.DragEvent, day: string, slot: Slot) {
    event.preventDefault();
    setDragOver(null);

    const raw = event.dataTransfer.getData("text/plain");
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Selection;
      if (parsed.kind === "food" || parsed.kind === "recipe") addTo(day, slot, parsed);
    } catch {
      // A drag from outside the palette carries nothing we understand.
    }
  }

  const weekLabel = `${shortDate(week)} – ${shortDate(addDays(week, 6), true)}`;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
            <p className="mt-1 text-xs text-black/45">{weekLabel}</p>
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={`/plan?week=${addDays(week, -7)}`}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-black/60 transition hover:bg-black/[0.03]"
            >
              ← Previous
            </Link>
            <Link
              href="/plan"
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-black/60 transition hover:bg-black/[0.03]"
            >
              This week
            </Link>
            <Link
              href={`/plan?week=${addDays(week, 7)}`}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-black/60 transition hover:bg-black/[0.03]"
            >
              Next →
            </Link>
          </div>
        </div>

        {profileIsDefault && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Targets use the default profile (a 30-year-old woman, moderate activity).{" "}
            <Link href="/profile" className="font-medium underline underline-offset-2">
              Set your own numbers
            </Link>
            .
          </p>
        )}

        {error && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
            {error}
          </p>
        )}

        {/* ---- Palette --------------------------------------------------- */}
        <section className="rounded-2xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-black/[0.04] p-0.5">
              {(
                [
                  { key: "recipe", label: `Recipes (${recipes.length})` },
                  { key: "food", label: `Foods (${foods.length})` },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTab(option.key)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    tab === option.key
                      ? "bg-white text-[#1f6f4a] shadow-sm"
                      : "text-black/45 hover:text-black/70"
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
              className="w-full max-w-xs rounded-lg border border-black/10 bg-[#faf9f7] px-3 py-1.5 text-xs outline-none placeholder:text-black/30 focus:border-[#1f6f4a]/50 focus:ring-2 focus:ring-[#1f6f4a]/10"
            />
          </div>

          <p className="mt-2 text-[11px] text-black/40">
            {selection
              ? `Selected: ${describe(selection)}. Tap a slot to place it, or drag it there.`
              : "Pick an item, then tap a slot — or drag it onto the day."}
          </p>

          <div className="mt-2 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
            {tab === "recipe"
              ? paletteRecipes.map((recipe) => {
                  const picked: Selection = { kind: "recipe", versionId: recipe.versionId };
                  const active =
                    selection?.kind === "recipe" &&
                    selection.versionId === recipe.versionId;

                  return (
                    <PaletteChip
                      key={recipe.versionId}
                      active={active}
                      onPick={() => setSelection(active ? null : picked)}
                      payload={picked}
                      title={recipe.name}
                      detail={`v${recipe.versionNo} · ${fmt(
                        recipe.perServing.totals.ENERC_KCAL,
                        0,
                      )} kcal / serving`}
                    />
                  );
                })
              : paletteFoods.map((food) => {
                  const picked: Selection = { kind: "food", id: food.id };
                  const active = selection?.kind === "food" && selection.id === food.id;

                  return (
                    <PaletteChip
                      key={food.id}
                      active={active}
                      onPick={() => setSelection(active ? null : picked)}
                      payload={picked}
                      title={food.name}
                      detail={`${fmt(food.nutrients.ENERC_KCAL.amount, 0)} kcal / 100 g`}
                    />
                  );
                })}
          </div>

          {selection && (
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="mt-2 text-[11px] font-medium text-black/40 underline underline-offset-2 hover:text-black/60"
            >
              Clear selection
            </button>
          )}
        </section>

        {/* ---- Week ------------------------------------------------------ */}
        <section className="mt-4 overflow-x-auto pb-1">
          <div className="grid min-w-[960px] grid-cols-7 gap-2">
            {days.map((day) => {
              const rollup = rollupsByDay.get(day);
              const kcal = rollup?.totals.ENERC_KCAL ?? null;
              const pct =
                kcal != null && energyTarget
                  ? Math.min(100, (kcal / energyTarget.value) * 100)
                  : 0;
              const dayEntries = entriesForDay(entries, day);
              const isToday = day === today;

              return (
                <div
                  key={day}
                  className={`flex flex-col rounded-xl border bg-white transition ${
                    selectedDay === day
                      ? "border-[#1f6f4a]/40 ring-2 ring-[#1f6f4a]/10"
                      : "border-black/[0.07]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className="rounded-t-xl px-2.5 pb-2 pt-2 text-left transition hover:bg-[#faf9f7]"
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          isToday ? "text-[#1f6f4a]" : "text-black/50"
                        }`}
                      >
                        {weekdayShort(day)}
                      </span>
                      <span className="tabular text-[11px] text-black/35">
                        {dayOfMonth(day)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="tabular text-sm font-semibold">
                        {kcal == null ? "—" : fmt(kcal, 0)}
                      </span>
                      <span className="text-[10px] text-black/35">kcal</span>
                    </div>

                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                      {kcal != null && (
                        <div
                          className="bar-fill h-full rounded-full bg-[#1f6f4a]"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </div>

                    <div className="mt-1 text-[10px] text-black/35">
                      {dayEntries.length === 0
                        ? "nothing planned"
                        : `${dayEntries.length} ${
                            dayEntries.length === 1 ? "item" : "items"
                          }`}
                    </div>
                  </button>

                  <div className="flex flex-1 flex-col gap-1 p-1.5 pt-0">
                    {SLOTS.map((slot) => {
                      const slotEntries = dayEntries.filter((entry) => entry.slot === slot);
                      const dropKey = `${day}:${slot}`;
                      const isOver = dragOver === dropKey;

                      return (
                        <div
                          key={slot}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "copy";
                            if (dragOver !== dropKey) setDragOver(dropKey);
                          }}
                          onDragLeave={() => setDragOver((current) => (current === dropKey ? null : current))}
                          onDrop={(event) => onDrop(event, day, slot)}
                          className={`rounded-lg border border-dashed p-1 transition ${
                            isOver
                              ? "border-[#1f6f4a]/60 bg-[#1f6f4a]/[0.06]"
                              : "border-transparent"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-black/30">
                              {SLOT_LABELS[slot]}
                            </span>
                            {selection && (
                              <button
                                type="button"
                                onClick={() => addTo(day, slot, selection)}
                                aria-label={`Add ${describe(selection)} to ${SLOT_LABELS[slot]} on ${weekdayShort(day)}`}
                                className="grid h-4 w-4 place-items-center rounded text-[11px] leading-none text-[#1f6f4a] transition hover:bg-[#1f6f4a]/10"
                              >
                                +
                              </button>
                            )}
                          </div>

                          {slotEntries.length === 0 ? (
                            selection ? (
                              <button
                                type="button"
                                onClick={() => addTo(day, slot, selection)}
                                className="mt-0.5 w-full rounded border border-dashed border-black/15 py-1 text-[10px] text-black/35 transition hover:border-[#1f6f4a]/40 hover:text-[#1f6f4a]"
                              >
                                Place here
                              </button>
                            ) : (
                              <p className="py-1 text-center text-[10px] text-black/20">—</p>
                            )
                          ) : (
                            <ul className="mt-0.5 space-y-1">
                              {slotEntries.map((entry) => (
                                <PlanEntryRow
                                  key={entry.id}
                                  entry={entry}
                                  name={entryName(entry, foodById, recipeByVersion)}
                                  kcal={entryKcal.get(entry.id) ?? null}
                                  onQuantity={(value) => setQuantity(entry, value)}
                                  onRemove={() => remove(entry)}
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
            })}
          </div>
        </section>

        {/* ---- Selected day --------------------------------------------- */}
        <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_420px] lg:items-start">
          <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {weekdayShort(selectedDay)} {dayOfMonth(selectedDay)}
              </h2>
              <span className="text-[11px] text-black/40">
                {selectedEntries.length}{" "}
                {selectedEntries.length === 1 ? "item" : "items"}
              </span>
            </div>

            {selectedEntries.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-black/10 px-3 py-8 text-center text-xs text-black/40">
                Nothing planned for this day yet. Pick a recipe or food above and place it in a
                slot.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-black/5">
                {selectedEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-black/30">
                      {SLOT_LABELS[entry.slot]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {entryName(entry, foodById, recipeByVersion)}
                    </span>
                    <span className="tabular text-xs text-black/45">
                      {entry.foodId
                        ? `${fmtMass(entry.grams)} g`
                        : `${fmt(entry.servings, entry.servings === 1 ? 0 : 1)} serving`}
                    </span>
                    <span className="tabular w-14 text-right text-xs text-black/55">
                      {fmt(entryKcal.get(entry.id) ?? null, 0)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="lg:sticky lg:top-20">
            <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Day nutrition</h2>
                <Link
                  href="/profile"
                  className="text-[11px] text-black/40 underline underline-offset-2 hover:text-black/60"
                >
                  Targets
                </Link>
              </div>

              {selectedEntries.length === 0 || selectedRollup == null ? (
                <p className="mt-3 rounded-xl border border-dashed border-black/10 px-3 py-8 text-center text-xs text-black/40">
                  Nothing planned, so there is nothing to total.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="tabular text-3xl font-semibold leading-none">
                        {fmt(selectedRollup.totals.ENERC_KCAL, 0)}
                        <span className="ml-1 text-sm font-normal text-black/40">kcal</span>
                      </div>
                      <div className="mt-1 text-[11px] text-black/40">
                        of {fmt(energyTarget?.value ?? null, 0)} kcal target
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className="bar-fill h-full rounded-full bg-[#1f6f4a]"
                      style={{
                        width: `${
                          energyTarget
                            ? Math.min(
                                100,
                                ((selectedRollup.totals.ENERC_KCAL ?? 0) /
                                  energyTarget.value) *
                                  100,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <div className="mt-5 space-y-5">
                    {GROUPS.map((group) => (
                      <div key={group.key}>
                        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
                          {group.label}
                        </h3>
                        <div className="space-y-2.5">
                          {NUTRIENT_CODES.filter(
                            (code) => NUTRIENTS[code].group === group.key,
                          ).map((code) => (
                            <NutrientBar
                              key={code}
                              code={code}
                              result={selectedRollup}
                              target={targetByCode.get(code)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </aside>
        </section>

        <footer className="mx-auto max-w-7xl pb-8 pt-4">
          <p className="text-[11px] leading-relaxed text-black/35">
            {pending ? "Saving… · " : ""}
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

function PaletteChip({
  title,
  detail,
  active,
  onPick,
  payload,
}: {
  title: string;
  detail: string;
  active: boolean;
  onPick: () => void;
  payload: Selection;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", JSON.stringify(payload));
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onPick}
      className={`max-w-[230px] cursor-grab rounded-lg border px-2.5 py-1.5 text-left transition active:cursor-grabbing ${
        active
          ? "border-[#1f6f4a]/50 bg-[#1f6f4a]/[0.07]"
          : "border-black/[0.08] bg-[#faf9f7] hover:border-black/20"
      }`}
    >
      <span className="block truncate text-xs font-medium">{title}</span>
      <span className="block truncate text-[10px] text-black/40">{detail}</span>
    </button>
  );
}

function PlanEntryRow({
  entry,
  name,
  kcal,
  onQuantity,
  onRemove,
}: {
  entry: PlanEntry;
  name: string;
  kcal: number | null;
  onQuantity: (value: number) => void;
  onRemove: () => void;
}) {
  const value = entry.foodId ? entry.grams ?? 0 : entry.servings ?? 0;

  return (
    <li className="rounded-md bg-[#faf9f7] px-1.5 py-1">
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
          {name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-[11px] leading-none text-black/25 transition hover:bg-black/5 hover:text-black/60"
        >
          ×
        </button>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-1">
        <label className="flex items-center gap-0.5 text-[10px] text-black/35">
          <input
            key={`${entry.id}:${value}`}
            type="number"
            min="0"
            step="any"
            defaultValue={value}
            aria-label={`${entry.foodId ? "Grams" : "Servings"} of ${name}`}
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
            className="tabular w-11 rounded border border-black/10 bg-white px-1 py-0.5 text-[10px] outline-none focus:border-[#1f6f4a]/50"
          />
          {entry.foodId ? "g" : "srv"}
        </label>
        <span className="tabular text-[10px] text-black/40">{fmt(kcal, 0)} kcal</span>
      </div>
    </li>
  );
}

function entryName(
  entry: PlanEntry,
  foodById: Map<string, Food>,
  recipeByVersion: Map<string, PlanRecipeOption>,
): string {
  if (entry.foodId) return foodById.get(entry.foodId)?.name ?? entry.foodId;
  if (entry.recipeVersionId) {
    const recipe = recipeByVersion.get(entry.recipeVersionId);
    return recipe ? `${recipe.name} v${recipe.versionNo}` : entry.recipeVersionId;
  }
  return "Unknown item";
}

function shortDate(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}
