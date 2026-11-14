"use client";

import { useMemo, useState, useTransition } from "react";
import { addFoodAction, removeEntryAction } from "@/app/actions";
import { NutrientBar } from "@/components/nutrient-bar";
import type { Entry } from "@/lib/db/entries";
import { dayRollup } from "@/lib/day";
import { searchFoods } from "@/lib/data/foods";
import { fmt, fmtDay } from "@/lib/format";
import { toGrams, type Unit } from "@/lib/nutrition/units";
import type { Rollup } from "@/lib/nutrition/engine";
import {
  NUTRIENTS,
  NUTRIENT_CODES,
  type Food,
  type NutrientGroup,
} from "@/lib/nutrition/types";
import type { Target } from "@/lib/targets";

interface DiaryProps {
  foods: Food[];
  entries: Entry[];
  targets: Target[];
  day: string;
}

function parseUnitKey(key: string): { unit: Unit; portionLabel?: string } {
  if (key.startsWith("portion:")) {
    return { unit: "portion", portionLabel: key.slice("portion:".length) };
  }
  return { unit: key as Unit };
}

export function Diary({ foods, entries, targets, day }: DiaryProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("100");
  const [unitKey, setUnitKey] = useState("g");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const results = useMemo(() => searchFoods(query), [query]);
  const selectedFood = foods.find((f) => f.id === selectedId) ?? null;
  const result = useMemo(() => dayRollup(entries), [entries]);

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
            <p className="mt-1 text-xs text-black/45">{fmtDay(day)}</p>
          </div>
          <p className="text-[11px] text-black/35">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · coverage shown per
            nutrient
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_420px] lg:items-start">
        {/* ---- Food search ---------------------------------------------- */}
        <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="text-sm font-semibold">Find a food</h2>
          <p className="mt-1 text-xs text-black/45">
            Search by name or a common Indian name.
          </p>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="paneer, palak, dal, doodh…"
            className="mt-3 w-full rounded-xl border border-black/10 bg-[#faf9f7] px-3.5 py-2.5 text-sm outline-none placeholder:text-black/30 focus:border-[#1f6f4a]/50 focus:ring-2 focus:ring-[#1f6f4a]/10"
          />

          <div className="mt-3 flex items-center justify-between text-[11px] text-black/40">
            <span>{results.length} foods</span>
            <span>values per 100 g</span>
          </div>

          <ul className="mt-2 divide-y divide-black/5">
            {results.map((food) => {
              const kcal = food.nutrients.ENERC_KCAL.amount;
              const isOpen = food.id === selectedId;

              return (
                <li key={food.id} className="py-1">
                  <button
                    type="button"
                    onClick={() => select(food)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-[#faf9f7]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{food.name}</span>
                      <span className="block truncate text-[11px] text-black/40">
                        {food.category} · {food.state}
                        {food.aliases.length > 0 && ` · ${food.aliases.slice(0, 2).join(", ")}`}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-xs text-black/55">
                      {fmt(kcal, 0)} kcal
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mb-2 ml-2 rounded-xl border border-black/[0.07] bg-[#faf9f7] p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1">
                          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-black/40">
                            Amount
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#1f6f4a]/50"
                          />
                        </label>

                        <label className="flex-1">
                          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-black/40">
                            Unit
                          </span>
                          <select
                            value={unitKey}
                            onChange={(event) => setUnitKey(event.target.value)}
                            className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#1f6f4a]/50"
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
                          className="rounded-lg bg-[#1f6f4a] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1a5c3d] disabled:opacity-50"
                        >
                          {pending ? "Adding…" : "Add"}
                        </button>
                      </div>

                      <p className="mt-2 text-[11px] text-black/50">
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
                              <span className="block text-amber-700/80">{preview.note}</span>
                            )}
                          </>
                        ) : preview ? (
                          <span className="text-red-700">{preview.reason}</span>
                        ) : null}
                      </p>

                      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- Today ---------------------------------------------------- */}
        <aside className="lg:sticky lg:top-20">
          <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Today</h2>
              <span className="text-[11px] text-black/40">
                {entries.length} {entries.length === 1 ? "item" : "items"}
              </span>
            </div>

            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="tabular text-3xl font-semibold leading-none">
                  {fmt(energy, 0)}
                  <span className="ml-1 text-sm font-normal text-black/40">kcal</span>
                </div>
                <div className="mt-1 text-[11px] text-black/40">
                  of {fmt(energyTarget?.value ?? null, 0)} kcal target
                </div>
              </div>
              <div className="text-right text-[11px] text-black/40">
                <div className="tabular">
                  {withData}/{tracked} nutrients
                </div>
                <div>have data</div>
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.06]">
              <div
                className="bar-fill h-full rounded-full bg-[#1f6f4a]"
                style={{ width: `${energyPct}%` }}
              />
            </div>

            <div className="mt-5 space-y-5">
              {groups.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
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
          </section>

          <section className="mt-4 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h2 className="text-sm font-semibold">Logged</h2>

            {entries.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-black/40">
                Nothing yet. Pick a food on the left to start.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-black/5">
                {entries.map((entry) => {
                  const food = foods.find((f) => f.id === entry.foodId);
                  const kcal = food?.nutrients.ENERC_KCAL.amount;
                  const entryKcal = kcal != null ? (kcal * entry.grams) / 100 : null;

                  return (
                    <li key={entry.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{food?.name ?? entry.foodId}</div>
                        <div className="text-[11px] text-black/40">
                          {fmt(entry.amount, entry.amount % 1 === 0 ? 0 : 1)}{" "}
                          {entry.unit.startsWith("portion:")
                            ? entry.unit.slice("portion:".length)
                            : entry.unit}
                          {" · "}
                          {fmt(entry.grams, 0)} g
                        </div>
                      </div>
                      <div className="tabular text-xs text-black/55">{fmt(entryKcal, 0)} kcal</div>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={`Remove ${food?.name ?? "entry"}`}
                        className="grid h-6 w-6 place-items-center rounded-md text-black/30 transition hover:bg-black/5 hover:text-black/60"
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
        <p className="text-[11px] leading-relaxed text-black/35">
          Seed dataset for development. Values are per 100 g edible portion from USDA SR
          Legacy and IFCT 2017 and have not yet been through the verified import pipeline.
          Missing values are shown as unknown, never as zero. This is a planning tool, not
          medical advice.
        </p>
      </footer>
    </div>
  );
}
