"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addFoodAction, removeEntryAction } from "@/app/actions";
import { NutrientBar } from "@/components/nutrient-bar";
import type { Entry } from "@/lib/db/entries";
import { dayRollup } from "@/lib/day";
import { searchFoods } from "@/lib/nutrition/food-search";
import { fmt, fmtDay } from "@/lib/format";
import { toGrams, type Unit } from "@/lib/nutrition/units";
import { weekStart } from "@/lib/plan";
import Link from "next/link";
import type { Rollup } from "@/lib/nutrition/engine";
import {
  NUTRIENTS,
  NUTRIENT_CODES,
  type Food,
  type NutrientGroup,
} from "@/lib/nutrition/types";
import type { Target } from "@/lib/targets";

export interface PlannedItem {
  id: string;
  slot: string;
  name: string;
  qty: string;
  kcal: number | null;
}

interface DiaryProps {
  foods: Food[];
  entries: Entry[];
  targets: Target[];
  day: string;
  planned: PlannedItem[];
  plannedKcal: number;
}

function parseUnitKey(key: string): { unit: Unit; portionLabel?: string } {
  if (key.startsWith("portion:")) {
    return { unit: "portion", portionLabel: key.slice("portion:".length) };
  }
  return { unit: key as Unit };
}

export function Diary({ foods, entries, targets, day, planned, plannedKcal }: DiaryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("100");
  const [unitKey, setUnitKey] = useState("g");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const results = useMemo(() => searchFoods(foods, query), [query]);
  const selectedFood = foods.find((f) => f.id === selectedId) ?? null;
  const result = useMemo(
    () =>
      dayRollup(
        entries,
        (id) =>
          foods.find((f) => f.id === id) ?? {
            id,
            name: "Deleted food",
            aliases: [],
            category: "Custom",
            kind: "provisional",
            state: "raw",
            portions: [],
            nutrients: Object.fromEntries(
              NUTRIENT_CODES.map((code) => [code, { amount: null, status: "unknown", source: "none" }]),
            ) as Food["nutrients"],
          },
      ),
    [entries, foods],
  );

  const targetByCode = useMemo(
    () => new Map(targets.map((t) => [t.code, t])),
    [targets],
  );

  const preview = useMemo(() => {
    if (!selectedFood) return null;
    const parsed = parseUnitKey(unitKey);
    return toGrams(selectedFood, {
      amount: Number(amount) || 0,
      unit: parsed.unit,
      portionLabel: parsed.portionLabel,
    });
  }, [selectedFood, amount, unitKey]);

  const previewKcal = useMemo(() => {
    if (!selectedFood || !preview?.ok) return null;
    const per100 = selectedFood.nutrients.ENERC_KCAL.amount;
    if (per100 == null) return null;
    return (per100 * preview.grams) / 100;
  }, [selectedFood, preview]);

  function select(food: Food) {
    setSelectedId(food.id === selectedId ? null : food.id);
    setError(null);
    setAmount("100");
    setUnitKey("g");
  }

  function submit() {
    if (!selectedFood) return;
    setError(null);
    const parsed = parseUnitKey(unitKey);

    startTransition(async () => {
      const response = await addFoodAction({
        foodId: selectedFood.id,
        amount: Number(amount),
        unit: parsed.unit,
        portionLabel: parsed.portionLabel,
      });

      if (!response.ok) {
        setError(response.message ?? "Could not add this food.");
        return;
      }
      setSelectedId(null);
      setAmount("100");
      setUnitKey("g");
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await removeEntryAction(id);
    });
  }

  const groups: { key: NutrientGroup; label: string }[] = [
    { key: "macro", label: "Macros" },
    { key: "mineral", label: "Minerals" },
    { key: "vitamin", label: "Vitamins" },
  ];

  const energy = result.totals.ENERC_KCAL;
  const energyTarget = targetByCode.get("ENERC_KCAL");
  const energyPct =
    energy != null && energyTarget ? Math.min(100, (energy / energyTarget.value) * 100) : 0;

  const tracked = NUTRIENT_CODES.length;
  const withData = NUTRIENT_CODES.filter((c) => result.totals[c] != null).length;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Diary</h1>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-xs text-ink/45">{fmtDay(day)}</p>
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  if (e.target.value) router.push(`/?day=${e.target.value}`);
                }}
                className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-ink/35">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · coverage shown per
            nutrient
          </p>
        </div>

        {planned.length > 0 && (
          <section className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Planned for this day</h2>
              <Link
                href={`/plan?week=${weekStart(day)}`}
                className="text-[11px] font-medium text-accent hover:underline"
              >
                Open in plan →
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {planned.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-ink/35">
                    {item.slot}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="tabular shrink-0 text-[11px] text-ink/45">{item.qty}</span>
                  <span className="tabular w-14 shrink-0 text-right text-[11px] text-ink/55">
                    {item.kcal != null ? `${Math.round(item.kcal)} kcal` : "—"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">
              {Math.round(plannedKcal)} kcal planned. Edit it on the plan page; the plan is the source.
            </p>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_420px] lg:items-start">
        {/* ---- Food search ---------------------------------------------- */}
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Find a food</h2>
          <p className="mt-1 text-xs text-ink/45">
            Search by name or a common Indian name.
          </p>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="paneer, palak, dal, doodh…"
            className="mt-3 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none placeholder:text-ink/30 focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
          />

          <div className="mt-3 flex items-center justify-between text-[11px] text-ink/40">
            <span>{results.length} foods</span>
            <span>values per 100 g</span>
          </div>

          <ul className="mt-2 divide-y divide-line">
            {results.map((food) => {
              const kcal = food.nutrients.ENERC_KCAL.amount;
              const isOpen = food.id === selectedId;

              return (
                <li key={food.id} className="py-1">
                  <button
                    type="button"
                    onClick={() => select(food)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{food.name}</span>
                      <span className="block truncate text-[11px] text-ink/40">
                        {food.category} · {food.state}
                        {food.aliases.length > 0 && ` · ${food.aliases.slice(0, 2).join(", ")}`}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-xs text-ink/55">
                      {fmt(kcal, 0)} kcal
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mb-2 ml-2 rounded-xl border border-line bg-surface-2 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1">
                          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink/40">
                            Amount
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent/50"
                          />
                        </label>

                        <label className="flex-1">
                          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink/40">
                            Unit
                          </span>
                          <select
                            value={unitKey}
                            onChange={(event) => setUnitKey(event.target.value)}
                            className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent/50"
                          >
                            <option value="g">g</option>
                            <option value="ml">ml</option>
                            {food.portions.map((portion) => (
                              <option key={portion.label} value={`portion:${portion.label}`}>
                                {portion.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          type="button"
                          onClick={submit}
                          disabled={pending}
                          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-strong disabled:opacity-50"
                        >
                          {pending ? "Adding…" : "Add"}
                        </button>
                      </div>

                      <p className="mt-2 text-[11px] text-ink/50">
                        {preview?.ok ? (
                          <>
                            = <span className="tabular font-medium">{fmt(preview.grams, 0)} g</span>
                            {previewKcal != null && (
                              <>
                                {" · "}
                                <span className="tabular font-medium">
                                  {fmt(previewKcal, 0)} kcal
                                </span>
                              </>
                            )}
                            {preview.note && (
                              <span className="block text-warn-ink">{preview.note}</span>
                            )}
                          </>
                        ) : preview ? (
                          <span className="text-danger">{preview.reason}</span>
                        ) : null}
                      </p>

                      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- Today ---------------------------------------------------- */}
        <aside className="min-w-0 lg:sticky lg:top-20">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Today</h2>
              <span className="text-[11px] text-ink/40">
                {entries.length} {entries.length === 1 ? "item" : "items"}
              </span>
            </div>

            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="tabular text-3xl font-semibold leading-none">
                  {fmt(energy, 0)}
                  <span className="ml-1 text-sm font-normal text-ink/40">kcal</span>
                </div>
                <div className="mt-1 text-[11px] text-ink/40">
                  of {fmt(energyTarget?.value ?? null, 0)} kcal target
                </div>
              </div>
              <div className="text-right text-[11px] text-ink/40">
                <div className="tabular">
                  {withData}/{tracked} nutrients
                </div>
                <div>have data</div>
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
              <div
                className={`bar-fill h-full rounded-full ${
                  energyTarget?.value && energy != null && energy / energyTarget.value >= 1.2
                    ? "bg-danger"
                    : energyTarget?.value && energy != null && energy / energyTarget.value > 1
                      ? "bg-warn"
                      : "bg-accent"
                }`}
                style={{ width: `${energyPct}%` }}
              />
            </div>

            <div className="mt-5 space-y-5">
              {groups.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                    {group.label}
                  </h3>
                  <div className="space-y-2.5">
                    {NUTRIENT_CODES.filter((code) => NUTRIENTS[code].group === group.key).map(
                      (code) => (
                        <NutrientBar
                          key={code}
                          code={code}
                          result={result}
                          target={targetByCode.get(code)}
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-5 border-t border-line pt-3 text-[10px] leading-relaxed text-ink/35">
              Energy and protein are judged per day. Fibre, vitamins and the limits are weekly
              averages — see the Plan page&apos;s Week view for those.
            </p>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-sm font-semibold">Logged</h2>

            {entries.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink/40">
                Nothing yet. Search for a food to add your first entry.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {entries.map((entry) => {
                  const food = foods.find((f) => f.id === entry.foodId);
                  const kcal = food?.nutrients.ENERC_KCAL.amount;
                  const entryKcal = kcal != null ? (kcal * entry.grams) / 100 : null;

                  return (
                    <li key={entry.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{food?.name ?? entry.foodId}</div>
                        <div className="text-[11px] text-ink/40">
                          {fmt(entry.amount, entry.amount % 1 === 0 ? 0 : 1)}{" "}
                          {entry.unit.startsWith("portion:")
                            ? entry.unit.slice("portion:".length)
                            : entry.unit}
                          {" · "}
                          {fmt(entry.grams, 0)} g
                        </div>
                      </div>
                      <div className="tabular text-xs text-ink/55">{fmt(entryKcal, 0)} kcal</div>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={`Remove ${food?.name ?? "entry"}`}
                        className="grid h-6 w-6 place-items-center rounded-md text-ink/30 transition hover:bg-ink/5 hover:text-ink/60"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
        </div>
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10 pt-2">
        <p className="text-[11px] leading-relaxed text-ink/35">
          Seed dataset for development. Values are per 100 g edible portion from USDA SR
          Legacy and IFCT 2017 and have not yet been through the verified import pipeline.
          Missing values are shown as unknown, never as zero. This is a planning tool, not
          medical advice.
        </p>
      </footer>
    </div>
  );
}
