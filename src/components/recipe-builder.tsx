"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveRecipeAction } from "@/app/actions";
import { searchFoods } from "@/lib/data/foods";
import { fmt, fmtMass } from "@/lib/format";
import { yieldNote } from "@/lib/nutrition/recipe";
import type { Food } from "@/lib/nutrition/types";
import {
  OPERATIONS,
  builderToDraft,
  emptyBlock,
  emptyInput,
  inputGrams,
  previewRecipe,
  toNumber,
  unitOptions,
  type BuilderBlock,
  type BuilderInput,
  type BuilderState,
} from "@/lib/recipe-draft";
import { MACRO_CODES, NutrientRows } from "@/components/nutrition-summary";

const STEPS = ["Ingredients", "Method", "Instructions", "Yield", "Review"];

const PREPARATIONS = [
  "raw",
  "boiled",
  "steamed",
  "pressure cooked",
  "pan fried",
  "deep fried",
  "roasted",
  "grated",
  "diced",
  "sliced",
  "chopped",
  "soaked",
  "crumbled",
];

interface RecipeBuilderProps {
  foods: Food[];
  initial: BuilderState;
  recipeId: string | null;
}

export function RecipeBuilder({ foods, initial, recipeId }: RecipeBuilderProps) {
  const router = useRouter();
  const [state, setState] = useState<BuilderState>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(() => previewRecipe(state, foods), [state, foods]);
  const result = preview.result;

  const completeInputs = state.blocks.reduce(
    (sum, block) =>
      sum +
      block.inputs.filter((input) => {
        const food = foods.find((candidate) => candidate.id === input.foodId);
        const grams = inputGrams(food, input);
        return grams.ok && grams.grams > 0;
      }).length,
    0,
  );

  const validServings = Number.isFinite(toNumber(state.servings)) && toNumber(state.servings) > 0;
  const canSave =
    state.name.trim().length > 0 && completeInputs > 0 && validServings && !pending;

  function patch(next: Partial<BuilderState>) {
    setState((current) => ({ ...current, ...next }));
  }

  function patchBlock(key: string, next: Partial<BuilderBlock>) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.key === key ? { ...block, ...next } : block)),
    }));
  }

  function patchInput(blockKey: string, inputKey: string, next: Partial<BuilderInput>) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.key === blockKey
          ? {
              ...block,
              inputs: block.inputs.map((input) =>
                input.key === inputKey ? { ...input, ...next } : input,
              ),
            }
          : block,
      ),
    }));
  }

  function addInput(blockKey: string) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.key === blockKey ? { ...block, inputs: [...block.inputs, emptyInput()] } : block,
      ),
    }));
  }

  function removeInput(blockKey: string, inputKey: string) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.key === blockKey
          ? { ...block, inputs: block.inputs.filter((input) => input.key !== inputKey) }
          : block,
      ),
    }));
  }

  function addBlock() {
    setState((current) => ({
      ...current,
      blocks: [...current.blocks, emptyBlock(`Step ${current.blocks.length + 1}`)],
    }));
  }

  function removeBlock(key: string) {
    setState((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => block.key !== key),
    }));
  }

  function save() {
    setError(null);
    if (!state.name.trim()) {
      setError("Give the recipe a name.");
      setStep(0);
      return;
    }
    if (completeInputs === 0) {
      setError("Add at least one ingredient with a quantity.");
      setStep(0);
      return;
    }

    startTransition(async () => {
      const response = await saveRecipeAction(builderToDraft(state, recipeId));
      if (!response.ok || !response.recipeId) {
        setError(response.message ?? "Could not save the recipe.");
        return;
      }
      router.push(`/recipes/${response.recipeId}`);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <datalist id="preparations">
        {PREPARATIONS.map((preparation) => (
          <option key={preparation} value={preparation} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-black/35">
            {recipeId ? "Editing recipe" : "New recipe"}
          </div>
          <input
            value={state.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Name this recipe"
            aria-label="Recipe name"
            className="mt-1 w-full border-none bg-transparent p-0 text-2xl font-semibold tracking-tight outline-none placeholder:text-black/20"
          />
        </div>
        <div className="text-xs text-black/40">
          Step {step + 1} of {STEPS.length}
        </div>
      </div>

      <nav className="mt-4 flex gap-1 overflow-x-auto pb-1" aria-label="Recipe sections">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              index === step
                ? "bg-[#1f6f4a] text-white"
                : index < step
                  ? "bg-[#1f6f4a]/10 text-[#1f6f4a]"
                  : "text-black/45 hover:bg-black/[0.04]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="mt-3 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {step === 0 && (
          <IngredientsStep
            foods={foods}
            blocks={state.blocks}
            onPatchBlock={patchBlock}
            onPatchInput={patchInput}
            onAddInput={addInput}
            onRemoveInput={removeInput}
            onAddBlock={addBlock}
            onRemoveBlock={removeBlock}
          />
        )}

        {step === 1 && (
          <MethodStep foods={foods} blocks={state.blocks} onPatchBlock={patchBlock} />
        )}

        {step === 2 && (
          <div>
            <h2 className="text-sm font-semibold">Instructions</h2>
            <p className="mt-1 text-xs text-black/45">
              Saved with this version as written. The MVP stores them as evidence; it does not
              parse them into steps or change any number.
            </p>
            <textarea
              value={state.instructions}
              onChange={(event) => patch({ instructions: event.target.value })}
              rows={10}
              placeholder={"1. Dice the onion…\n2. Heat the oil…"}
              className="mt-3 w-full rounded-xl border border-black/10 bg-[#faf9f7] p-3 text-sm leading-relaxed outline-none placeholder:text-black/25 focus:border-[#1f6f4a]/50 focus:ring-2 focus:ring-[#1f6f4a]/10"
            />
          </div>
        )}

        {step === 3 && (
          <YieldStep foods={foods} state={state} onPatch={patch} onPatchBlock={patchBlock} />
        )}

        {step === 4 && <ReviewStep foods={foods} state={state} onPatch={patch} />}
      </section>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <Link href="/recipes" className="text-xs text-black/45 hover:text-black/70">
          Cancel
        </Link>

        <div className="flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              className="rounded-lg border border-black/10 px-3.5 py-2 text-xs font-medium text-black/60 transition hover:bg-black/[0.03]"
            >
              Back
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
              className="rounded-lg bg-[#1f6f4a] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#1a5c3d]"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="rounded-lg bg-[#1f6f4a] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#1a5c3d] disabled:opacity-40"
            >
              {pending ? "Saving…" : recipeId ? "Save as new version" : "Save recipe"}
            </button>
          )}
        </div>
      </div>

      {result && (
        <p className="mt-3 text-[11px] text-black/35">
          {fmt(result.perServing.totals.ENERC_KCAL, 0)} kcal per serving ·{" "}
          {fmt(state.servings ? toNumber(state.servings) : null, 1)} servings
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- step 0 */

function IngredientsStep({
  foods,
  blocks,
  onPatchBlock,
  onPatchInput,
  onAddInput,
  onRemoveInput,
  onAddBlock,
  onRemoveBlock,
}: {
  foods: Food[];
  blocks: BuilderBlock[];
  onPatchBlock: (key: string, next: Partial<BuilderBlock>) => void;
  onPatchInput: (blockKey: string, inputKey: string, next: Partial<BuilderInput>) => void;
  onAddInput: (blockKey: string) => void;
  onRemoveInput: (blockKey: string, inputKey: string) => void;
  onAddBlock: () => void;
  onRemoveBlock: (key: string) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">Ingredients</h2>
      <p className="mt-1 text-xs text-black/45">
        Add one ingredient at a time. Group them into steps if the dish is cooked in stages —
        each step gets its own subtotal and can record a measured output weight.
      </p>

      <div className="mt-4 space-y-4">
        {blocks.map((block, blockIndex) => (
          <div key={block.key} className="rounded-xl border border-black/[0.07] p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-black/[0.05] text-[10px] font-semibold text-black/50">
                {blockIndex + 1}
              </span>
              <input
                value={block.name}
                onChange={(event) => onPatchBlock(block.key, { name: event.target.value })}
                aria-label={`Step ${blockIndex + 1} name`}
                className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm font-medium outline-none"
              />
              {blocks.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveBlock(block.key)}
                  className="text-[11px] text-black/35 transition hover:text-red-700"
                >
                  Remove step
                </button>
              )}
            </div>

            <div className="mt-2.5 space-y-2">
              {block.inputs.map((input) => (
                <IngredientRow
                  key={input.key}
                  foods={foods}
                  input={input}
                  onChange={(next) => onPatchInput(block.key, input.key, next)}
                  onRemove={() => onRemoveInput(block.key, input.key)}
                  canRemove={block.inputs.length > 1}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => onAddInput(block.key)}
              className="mt-2 rounded-lg border border-dashed border-black/15 px-3 py-1.5 text-[11px] font-medium text-black/50 transition hover:border-[#1f6f4a]/40 hover:text-[#1f6f4a]"
            >
              + Add ingredient
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddBlock}
        className="mt-3 rounded-lg border border-dashed border-black/15 px-3 py-2 text-[11px] font-medium text-black/50 transition hover:border-[#1f6f4a]/40 hover:text-[#1f6f4a]"
      >
        + Add another step
      </button>
    </div>
  );
}

function IngredientRow({
  foods,
  input,
  onChange,
  onRemove,
  canRemove,
}: {
  foods: Food[];
  input: BuilderInput;
  onChange: (next: Partial<BuilderInput>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const food = foods.find((candidate) => candidate.id === input.foodId);
  const grams = inputGrams(food, input);
  const kcal =
    food && grams.ok && food.nutrients.ENERC_KCAL.amount != null
      ? (food.nutrients.ENERC_KCAL.amount * grams.grams) / 100
      : null;

  return (
    <div className="rounded-xl bg-[#faf9f7] p-2.5">
      <div className="flex items-start gap-2">
        <FoodPicker foods={foods} value={input.foodId} onSelect={(foodId) => onChange({ foodId, unitKey: "g" })} />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove ingredient"
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-black/30 transition hover:bg-black/5 hover:text-black/60 disabled:opacity-30"
        >
          ×
        </button>
      </div>

      {food && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-black/35">
                Amount
              </span>
              <input
                inputMode="decimal"
                value={input.amount}
                onChange={(event) => onChange({ amount: event.target.value })}
                className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[#1f6f4a]/50"
              />
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-black/35">
                Unit
              </span>
              <select
                value={input.unitKey}
                onChange={(event) => onChange({ unitKey: event.target.value })}
                className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[#1f6f4a]/50"
              >
                {unitOptions(food).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-black/35">
                Preparation
              </span>
              <input
                list="preparations"
                value={input.preparation}
                onChange={(event) => onChange({ preparation: event.target.value })}
                placeholder="raw, boiled…"
                className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-black/25 focus:border-[#1f6f4a]/50"
              />
            </label>
          </div>

          <p className="mt-1.5 text-[11px] text-black/45">
            {grams.ok ? (
              <>
                = <span className="tabular font-medium">{fmtMass(grams.grams)} g</span>
                {kcal != null && (
                  <>
                    {" · "}
                    <span className="tabular font-medium">{fmt(kcal, 0)} kcal</span>
                  </>
                )}
                {grams.note && <span className="block text-amber-700/80">{grams.note}</span>}
              </>
            ) : (
              <span className="text-red-700">{grams.reason}</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function FoodPicker({
  foods,
  value,
  onSelect,
}: {
  foods: Food[];
  value: string;
  onSelect: (foodId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = foods.find((food) => food.id === value);
  const results = useMemo(() => {
    const list = query.trim() ? searchFoods(query) : foods;
    return list.slice(0, 8);
  }, [query, foods]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-black/[0.03]"
      >
        {selected ? (
          <>
            <span className="block truncate text-sm font-medium">{selected.name}</span>
            <span className="block text-[11px] text-black/40">
              {selected.category} · {fmt(selected.nutrients.ENERC_KCAL.amount, 0)} kcal/100 g
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm text-black/35">Choose a food…</span>
            <span className="block text-[11px] text-black/30">search by name or Indian name</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        placeholder="paneer, palak, dal…"
        className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#1f6f4a]/50"
      />
      <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-black/10 bg-white">
        {results.map((food) => (
          <li key={food.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(food.id);
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left transition hover:bg-[#faf9f7]"
            >
              <span className="truncate text-sm">{food.name}</span>
              <span className="tabular shrink-0 text-[11px] text-black/40">
                {fmt(food.nutrients.ENERC_KCAL.amount, 0)} kcal
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 && (
          <li className="px-2.5 py-2 text-xs text-black/40">No match in the food list.</li>
        )}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- step 1 */

function MethodStep({
  foods,
  blocks,
  onPatchBlock,
}: {
  foods: Food[];
  blocks: BuilderBlock[];
  onPatchBlock: (key: string, next: Partial<BuilderBlock>) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">Method</h2>
      <p className="mt-1 text-xs text-black/45">
        Name each step and say what happens to it. An operation is a label: it changes no number
        unless you record a measured output weight in the next section.
      </p>

      <div className="mt-4 space-y-2">
        {blocks.map((block, index) => {
          const items = block.inputs
            .map((input) => {
              const food = foods.find((candidate) => candidate.id === input.foodId);
              if (!food) return null;
              const grams = inputGrams(food, input);
              return grams.ok ? `${food.name} ${fmtMass(grams.grams)} g` : null;
            })
            .filter((item): item is string => item != null);

          return (
            <div
              key={block.key}
              className="grid gap-2 rounded-xl border border-black/[0.07] p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <span className="grid h-6 w-6 place-items-center rounded-md bg-black/[0.05] text-[11px] font-semibold text-black/50">
                {index + 1}
              </span>

              <div className="min-w-0">
                <input
                  value={block.name}
                  onChange={(event) => onPatchBlock(block.key, { name: event.target.value })}
                  aria-label={`Step ${index + 1} name`}
                  className="w-full border-none bg-transparent p-0 text-sm font-medium outline-none"
                />
                <p className="mt-0.5 truncate text-[11px] text-black/40">
                  {items.length > 0 ? items.join(" · ") : "No ingredients yet"}
                </p>
              </div>

              <select
                value={block.operation}
                onChange={(event) => onPatchBlock(block.key, { operation: event.target.value })}
                aria-label={`Operation for step ${index + 1}`}
                className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs outline-none focus:border-[#1f6f4a]/50"
              >
                <option value="">no operation</option>
                {OPERATIONS.map((operation) => (
                  <option key={operation} value={operation}>
                    {operation}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- step 3 */

function YieldStep({
  foods,
  state,
  onPatch,
  onPatchBlock,
}: {
  foods: Food[];
  state: BuilderState;
  onPatch: (next: Partial<BuilderState>) => void;
  onPatchBlock: (key: string, next: Partial<BuilderBlock>) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">Yield and servings</h2>
      <p className="mt-1 text-xs text-black/45">
        Weigh the pan after cooking if you can. That is the only thing that changes the per-100 g
        figure — the total amount of protein in the dish does not change when water boils off.
      </p>

      <label className="mt-4 block max-w-[12rem]">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-black/40">
          Servings
        </span>
        <input
          inputMode="decimal"
          value={state.servings}
          onChange={(event) => onPatch({ servings: event.target.value })}
          className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#1f6f4a]/50"
        />
      </label>

      <div className="mt-5 space-y-2">
        {state.blocks.map((block, index) => {
          const inputMass = block.inputs.reduce((sum, input) => {
            const food = foods.find((candidate) => candidate.id === input.foodId);
            const grams = inputGrams(food, input);
            return sum + (grams.ok ? grams.grams : 0);
          }, 0);
          const output = toNumber(block.outputGrams);

          return (
            <div
              key={block.key}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.07] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {index + 1}. {block.name}
                </div>
                <div className="text-[11px] text-black/40">
                  {fmtMass(inputMass)} g in
                  {block.operation ? ` · ${block.operation}` : ""}
                </div>
              </div>

              <label className="flex items-center gap-2">
                <span className="text-[11px] text-black/45">output</span>
                <input
                  inputMode="decimal"
                  value={block.outputGrams}
                  onChange={(event) =>
                    onPatchBlock(block.key, { outputGrams: event.target.value })
                  }
                  placeholder="—"
                  className="w-20 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-black/25 focus:border-[#1f6f4a]/50"
                />
                <span className="text-[11px] text-black/45">g</span>
              </label>

              {Number.isFinite(output) && output > 0 && inputMass > 0 && (
                <span className="tabular text-[11px] text-black/45">
                  {fmt((output / inputMass) * 100, 0)}% of input mass
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- step 4 */

function ReviewStep({
  foods,
  state,
  onPatch,
}: {
  foods: Food[];
  state: BuilderState;
  onPatch: (next: Partial<BuilderState>) => void;
}) {
  const { result, incomplete, problem } = previewRecipe(state, foods);

  if (!result) {
    return (
      <div>
        <h2 className="text-sm font-semibold">Review</h2>
        <p className="mt-2 rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-black/40">
          {problem === "servings"
            ? "Enter how many servings this makes to see the totals."
            : "Add at least one ingredient with a quantity to see the totals."}
        </p>
      </div>
    );
  }

  const partial = Object.keys(result.total.coverage).filter((code) => {
    const key = code as keyof typeof result.total.coverage;
    return (
      result.total.totals[key] != null &&
      result.total.coverage[key].known < result.total.coverage[key].total
    );
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold">Review</h2>
        <label className="flex items-center gap-2 text-[11px] text-black/45">
          servings
          <input
            inputMode="decimal"
            value={state.servings}
            onChange={(event) => onPatch({ servings: event.target.value })}
            className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-black outline-none focus:border-[#1f6f4a]/50"
          />
        </label>
      </div>

      <div className="mt-3 rounded-xl bg-[#faf9f7] p-4">
        <div className="tabular text-3xl font-semibold leading-none">
          {fmt(result.perServing.totals.ENERC_KCAL, 0)}
          <span className="ml-1 text-sm font-normal text-black/40">kcal / serving</span>
        </div>
        <p className="mt-1 text-[11px] text-black/45">
          {fmt(result.total.totals.ENERC_KCAL, 0)} kcal total · {fmtMass(result.inputGrams)} g of
          ingredients
          {result.outputGrams != null && ` · ${fmtMass(result.outputGrams)} g cooked`}
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
            Per serving
          </h3>
          <NutrientRows result={result.perServing} codes={MACRO_CODES} />
        </div>
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
            Steps
          </h3>
          <ul className="space-y-1.5">
            {result.blocks.map((block, index) => (
              <li
                key={`${block.name}-${index}`}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="min-w-0 truncate text-black/60">
                  {index + 1}. {block.name}
                  {block.operation && (
                    <span className="text-black/30"> · {block.operation}</span>
                  )}
                </span>
                <span className="tabular shrink-0 text-black/55">
                  {fmt(block.result.totals.ENERC_KCAL, 0)} kcal
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {result.per100g && (
        <div className="mt-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
            Per 100 g cooked
          </h3>
          <NutrientRows result={result.per100g} codes={MACRO_CODES} />
        </div>
      )}

      <div className="mt-4 space-y-2 text-[11px] leading-relaxed">
        <p className="rounded-lg bg-[#faf9f7] px-3 py-2 text-black/50">{yieldNote(result)}</p>

        {partial.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            Partial data for {partial.length}{" "}
            {partial.length === 1 ? "nutrient" : "nutrients"} — the figure is the sum of the
            ingredients that have a value, not a guess at the rest. The small number beside a
            value shows how many ingredients it covers.
          </p>
        )}

        {incomplete > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            {incomplete} {incomplete === 1 ? "row is" : "rows are"} incomplete and will be left
            out.
          </p>
        )}
      </div>
    </div>
  );
}
