import Link from "next/link";
import { notFound } from "next/navigation";
import { MACRO_CODES, MICRO_CODES, NutrientRows } from "@/components/nutrition-summary";
import { getFood } from "@/lib/data/foods";
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

  const snapshot = version.snapshot;
  const isCurrent = version.id === recipe.summary.currentVersionId;
  const knownNutrients = NUTRIENT_CODES.filter((code) => snapshot.total.totals[code] != null).length;

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/recipes" className="text-[11px] text-black/40 hover:text-black/60">
            ← Recipes
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{version.recipeName}</h1>
          <p className="mt-1 text-[11px] text-black/45">
            Version {version.versionNo}
            {!isCurrent && " · not the current version"}
            {" · "}
            {fmt(version.servings, 0)} {version.servings === 1 ? "serving" : "servings"}
            {" · "}
            {knownNutrients}/{NUTRIENT_CODES.length} nutrients known
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/recipes/${id}/edit`}
            className="rounded-lg border border-black/10 px-3.5 py-2 text-xs font-medium text-black/60 transition hover:bg-black/[0.03]"
          >
            Edit
          </Link>
          <Link
            href="/recipes/new"
            className="rounded-lg bg-[#1f6f4a] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#1a5c3d]"
          >
            New recipe
          </Link>
        </div>
      </div>

      <section className="mt-4 grid gap-4 sm:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="tabular text-4xl font-semibold leading-none">
            {fmt(snapshot.perServing.totals.ENERC_KCAL, 0)}
            <span className="ml-1.5 text-sm font-normal text-black/40">kcal / serving</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-black/45">
            {fmt(snapshot.total.totals.ENERC_KCAL, 0)} kcal total · {fmtMass(snapshot.inputGrams)}{" "}
            g of ingredients
            {snapshot.outputGrams != null && ` · ${fmtMass(snapshot.outputGrams)} g cooked`}
          </p>

          <div className="mt-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
              Per serving
            </h2>
            <NutrientRows result={snapshot.perServing} codes={MACRO_CODES} />
          </div>
        </div>

        <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-black/35">
            How this was calculated
          </h2>
          <p className="mt-2 text-[11px] leading-relaxed text-black/55">{yieldNote(snapshot)}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-black/55">
            Every ingredient is scaled from its per-100 g record by the weight you entered. A
            nutrient is marked <span className="font-medium">known</span> only when every
            ingredient has a value for it; otherwise the figure is the sum of what is known and
            the small number beside it shows the coverage.
          </p>
          {snapshot.per100g && (
            <div className="mt-4">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">
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
              className="rounded-2xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  <span className="mr-1.5 text-black/35">{index + 1}.</span>
                  {block.name}
                  {block.operation && (
                    <span className="ml-2 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-black/50">
                      {block.operation}
                    </span>
                  )}
                </h3>
                <div className="tabular text-[11px] text-black/45">
                  {fmt(blockResult?.result.totals.ENERC_KCAL, 0)} kcal
                  {block.outputGrams != null && ` · ${fmtMass(block.outputGrams)} g out`}
                </div>
              </div>

              <ul className="mt-2 divide-y divide-black/5">
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
                          <span className="ml-1.5 text-[11px] text-black/35">
                            {input.preparation}
                          </span>
                        )}
                        {input.note && (
                          <span className="ml-1.5 text-[11px] italic text-black/35">
                            {input.note}
                          </span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-[11px] text-black/45">
                        {fmtQuantity(input.amount, input.unit)} · {fmtMass(input.grams)} g ·{" "}
                        {fmt(kcal, 0)} kcal
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {version.instructions && (
        <section className="mt-4 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="text-sm font-semibold">Instructions</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">
            {version.instructions}
          </p>
        </section>
      )}

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-black/35">
            Minerals
          </h2>
          <div className="mt-2">
            <NutrientRows result={snapshot.total} codes={MICRO_CODES.slice(0, 6)} />
          </div>
        </div>
        <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-black/35">
            Vitamins
          </h2>
          <div className="mt-2">
            <NutrientRows result={snapshot.total} codes={MICRO_CODES.slice(6)} />
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="text-sm font-semibold">Versions</h2>
        <p className="mt-1 text-[11px] text-black/45">
          Editing saves a new version. The plan that used an older version keeps using it.
        </p>
        <ul className="mt-3 divide-y divide-black/5">
          {recipe.versions.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-medium">
                  Version {entry.versionNo}
                  {entry.isCurrent && (
                    <span className="ml-2 rounded-md bg-[#1f6f4a]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#1f6f4a]">
                      current
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-black/40">
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
                <span className="tabular text-[11px] text-black/45">
                  {fmt(entry.kcalPerServing, 0)} kcal / serving
                </span>
                <Link
                  href={`/recipes/${id}?version=${entry.id}`}
                  className="text-[11px] text-[#1f6f4a] hover:underline"
                >
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 text-[11px] leading-relaxed text-black/35">
        Values come from the seed dataset (USDA SR Legacy and IFCT 2017, unverified). Missing
        values are shown as unknown, never as zero. Calculation version{" "}
        {version.calculationVersion}. Nutrient vocabulary:{" "}
        {NUTRIENT_CODES.slice(0, 3).map((code) => NUTRIENTS[code].short).join(", ")} and{" "}
        {NUTRIENT_CODES.length - 3} more.
      </p>
    </main>
  );
}
