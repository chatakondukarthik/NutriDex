import Link from "next/link";
import { DuplicateRecipeButton } from "@/components/duplicate-recipe-button";
import { DeleteVersionButton } from "@/components/delete-version-button";
import { MakeCurrentButton } from "@/components/make-current-button";
import { FillRecipeNutritionButton } from "@/components/fill-recipe-nutrition-button";
import { StepNutrition } from "@/components/step-nutrition";
import { DeleteButton } from "@/components/delete-button";
import { deleteRecipeAction } from "@/app/actions";
import { notFound } from "next/navigation";
import { MACRO_CODES, MICRO_CODES, NutrientRows } from "@/components/nutrition-summary";
import { getFood } from "@/lib/db/foods";
import { getRecipe, getVersion } from "@/lib/db/recipes";
import { fmt, fmtMass, fmtQuantity } from "@/lib/format";
import { yieldNote } from "@/lib/nutrition/recipe";
import { NUTRIENTS, NUTRIENT_CODES } from "@/lib/nutrition/types";

export const dynamic = "force-dynamic";

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version: requestedVersion } = await searchParams;

  const recipe = getRecipe(id);
  if (!recipe) notFound();

  const versionId =
    typeof requestedVersion === "string" && requestedVersion
      ? requestedVersion
      : recipe.summary.currentVersionId;

  const version = versionId ? getVersion(versionId) : undefined;
  if (!version || version.recipeId !== id) notFound();

  // Captured ingredients with missing nutrients — candidates for AI fill.
  const isCurrent = version.id === recipe.summary.currentVersionId;

  const fillTargets: { id: string; name: string; missing: number }[] = (() => {
    if (!isCurrent) return [];
    const seen = new Set<string>();
    const missingById = new Map<string, { id: string; name: string; missing: number }>();
    for (const block of version.blocks ?? []) {
      for (const input of block.inputs) {
        if (seen.has(input.foodId)) continue;
        seen.add(input.foodId);
        const food = getFood(input.foodId);
        if (!food?.source) continue; // seeds/fixtures are read-only
        const missing = NUTRIENT_CODES.filter((code) => food.nutrients[code]?.amount == null).length;
        if (missing > 0) missingById.set(food.id, { id: food.id, name: food.name, missing });
      }
    }
    return [...missingById.values()];
  })();

  const snapshot = version.snapshot;
  const knownNutrients = NUTRIENT_CODES.filter((code) => snapshot.total.totals[code] != null).length;

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/recipes" className="text-[11px] text-ink/40 hover:text-ink/60">
            ← Recipes
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {version.recipeName}
            {version.label && (
              <span className="ml-2 align-middle text-base font-normal text-ink/45">
                {version.label}
              </span>
            )}
          </h1>
          <p className="mt-1 text-[11px] text-ink/45">
            Version {version.versionNo}
            {!isCurrent && (
              <span className="ml-2 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn-ink">
                you are viewing, not the current version
              </span>
            )}
            {" · "}
            {fmt(version.servings, 0)} {version.servings === 1 ? "serving" : "servings"}
            {" · "}
            {knownNutrients}/{NUTRIENT_CODES.length} nutrients known
          </p>
        </div>

        <div className="flex items-center gap-2">
          {fillTargets.length > 0 && <FillRecipeNutritionButton foods={fillTargets} />}
          <Link
            href={`/recipes/${id}/edit`}
            className="rounded-lg border border-line px-3.5 py-2 text-xs font-medium text-ink/60 transition hover:bg-ink/5"
          >
            Edit
          </Link>
          <DuplicateRecipeButton recipeId={id} />
          <DeleteButton
            label="Delete"
            redirectTo="/recipes"
            action={deleteRecipeAction}
            arg={id}
            confirmText="Delete this recipe? If a plan uses it, it will be archived instead."
          />
          <Link
            href="/recipes/new"
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition hover:bg-accent-strong"
          >
            New recipe
          </Link>
        </div>
      </div>

      {!isCurrent && (
        <aside className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn-line bg-warn-soft px-4 py-3">
          <p className="text-[11px] leading-relaxed text-warn-ink">
            You are looking at <span className="font-semibold">v{version.versionNo}</span>, not the
            current version. Plans and diary entries always pin the version they were saved
            against — this just changes where new logs come from.
          </p>
          <MakeCurrentButton recipeId={id} versionId={version.id} versionNo={version.versionNo} />
        </aside>
      )}

      <section className="mt-4 grid gap-4 sm:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="tabular text-4xl font-semibold leading-none">
            {fmt(snapshot.perServing.totals.ENERC_KCAL, 0)}
            <span className="ml-1.5 text-sm font-normal text-ink/40">kcal / serving</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
            {fmt(snapshot.total.totals.ENERC_KCAL, 0)} kcal total · {fmtMass(snapshot.inputGrams)}{" "}
            g of ingredients
            {snapshot.outputGrams != null && ` · ${fmtMass(snapshot.outputGrams)} g cooked`}
          </p>

          <div className="mt-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
              Per serving
            </h2>
            <NutrientRows result={snapshot.perServing} codes={MACRO_CODES} />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">
            How this was calculated
          </h2>
          <p className="mt-2 text-[11px] leading-relaxed text-ink/55">{yieldNote(snapshot)}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink/55">
            Every ingredient is scaled from its per-100 g record by the weight you entered. A
            nutrient is marked <span className="font-medium">known</span> only when every
            ingredient has a value for it; otherwise the figure is the sum of what is known and
            the small number beside it shows the coverage.
          </p>
          {snapshot.per100g && (
            <div className="mt-4">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                Per 100 g cooked
              </h3>
              <NutrientRows result={snapshot.per100g} codes={MACRO_CODES} />
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 space-y-3">
        <h2 className="text-sm font-semibold">Steps</h2>
        {version.blocks.map((block, index) => {
          const blockResult = snapshot.blocks[index];

          return (
            <div
              key={block.id}
              className="rounded-2xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  <span className="mr-1.5 text-ink/35">{index + 1}.</span>
                  {block.name}
                  {block.operation && (
                    <span className="ml-2 rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/50">
                      {block.operation}
                    </span>
                  )}
                </h3>
                <div className="tabular text-[11px] text-ink/45">
                  {fmt(blockResult?.result.totals.ENERC_KCAL, 0)} kcal
                  {block.outputGrams != null && ` · ${fmtMass(block.outputGrams)} g out`}
                </div>
              </div>

              <ul className="mt-2 divide-y divide-line">
                {block.inputs.map((input) => {
                  const food = getFood(input.foodId);
                  const kcal =
                    food?.nutrients.ENERC_KCAL.amount != null
                      ? (food.nutrients.ENERC_KCAL.amount * input.grams) / 100
                      : null;

                  return (
                    <li
                      key={input.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                    >
                      <span className="min-w-0 text-sm">
                        {food?.name ?? input.foodId}
                        {input.preparation && (
                          <span className="ml-1.5 text-[11px] text-ink/35">
                            {input.preparation}
                          </span>
                        )}
                        {input.note && (
                          <span className="ml-1.5 text-[11px] italic text-ink/35">
                            {input.note}
                          </span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-[11px] text-ink/45">
                        {fmtQuantity(input.amount, input.unit)} · {fmtMass(input.grams)} g ·{" "}
                        {fmt(kcal, 0)} kcal
                      </span>
                    </li>
                  );
                })}
              </ul>

              {blockResult?.note && (
                <p className="mt-2 whitespace-pre-wrap break-words text-[11px] italic leading-snug text-ink/45">
                  📝 {blockResult.note}
                </p>
              )}

              {blockResult?.result && (
                <details className="mt-3 rounded-lg border border-line/60 bg-canvas/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink/55">
                    Block nutrients · {fmt(blockResult.result.totals.ENERC_KCAL, 0)} kcal
                    {block.outputGrams != null ? ` · ${fmtMass(block.outputGrams)} g out` : ""}
                  </summary>
                  <div className="mt-2">
                    <NutrientRows result={blockResult.result} codes={MACRO_CODES} />
                  </div>
                  {block.operation && (
                    <p className="mt-2 text-[10px] text-ink/35">
                      Operation: {block.operation}. Nutrients are scaled by the output mass, so a
                      boiled or reduced block changes the per-100 g values but not the totals.
                    </p>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </section>

      <StepNutrition snapshot={snapshot as never} />

      {version.instructions && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Instructions</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
            {version.instructions}
          </p>
        </section>
      )}

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">
            Minerals
          </h2>
          <div className="mt-2">
            <NutrientRows result={snapshot.total} codes={MICRO_CODES.slice(0, 6)} />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">
            Vitamins
          </h2>
          <div className="mt-2">
            <NutrientRows result={snapshot.total} codes={MICRO_CODES.slice(6)} />
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold">Versions</h2>
        <p className="mt-1 text-[11px] text-ink/45">
          Editing saves a new version. The plan that used an older version keeps using it.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {recipe.versions.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-medium">
                  Version {entry.versionNo}
                  {entry.label && (
                    <span className="ml-1.5 font-normal text-ink/55">· {entry.label}</span>
                  )}
                  {entry.isCurrent && (
                    <span className="ml-2 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      current
                    </span>
                  )}
                  {entry.id === version.id && !entry.isCurrent && (
                    <span className="ml-2 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn-ink">
                      viewing
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink/40">
                  {new Date(entry.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="tabular text-[11px] text-ink/45">
                  {fmt(entry.kcalPerServing, 0)} kcal / serving
                </span>
                <Link
                  href={`/recipes/${id}?version=${entry.id}`}
                  className="text-[11px] text-accent hover:underline"
                >
                  View
                </Link>
                <Link
                  href={`/recipes/${id}/edit?version=${entry.id}`}
                  className="text-[11px] text-ink/55 hover:text-ink hover:underline"
                >
                  Edit
                </Link>
                <DeleteVersionButton recipeId={id} versionId={entry.id} versionNo={entry.versionNo} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 text-[11px] leading-relaxed text-ink/35">
        Values come from the seed dataset (USDA SR Legacy and IFCT 2017, unverified). Missing
        values are shown as unknown, never as zero. Calculation version{" "}
        {version.calculationVersion}. Nutrient vocabulary:{" "}
        {NUTRIENT_CODES.slice(0, 3).map((code) => NUTRIENTS[code].short).join(", ")} and{" "}
        {NUTRIENT_CODES.length - 3} more.
      </p>
    </main>
  );
}
