import Link from "next/link";
import { PRESETS } from "@/lib/data/preset-recipes";
import { listRecipes } from "@/lib/db/recipes";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function RecipesPage() {
  const recipes = listRecipes();

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recipes</h1>
          <p className="mt-1 text-xs text-ink/45">
            Every save is a new version. Old versions stay exactly as they were.
          </p>
        </div>
        <Link
          href="/recipes/new"
          className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition hover:bg-accent-strong"
        >
          New recipe
        </Link>
      </div>

      {recipes.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center">
          <h2 className="text-sm font-semibold">Nothing saved yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink/45">
            A recipe is a named thing you will cook again — not a one-off plate. Start from a
            preset and change it, or build one from your own ingredients.
          </p>
        </section>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link
                href={`/recipes/${recipe.id}`}
                className="block h-full rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-accent/30 hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug">{recipe.name}</h2>
                  <span className="shrink-0 rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/45">
                    v{recipe.currentVersionNo ?? 1}
                  </span>
                </div>

                {recipe.currentVersionLabel && (
                  <p className="mt-0.5 truncate text-[11px] text-ink/40">
                    {recipe.currentVersionLabel}
                  </p>
                )}

                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="tabular text-xl font-semibold leading-none">
                    {fmt(recipe.kcalPerServing, 0)}
                  </span>
                  <span className="text-[11px] text-ink/40">kcal / serving</span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-ink/40">
                  <span>
                    {fmt(recipe.servings, 0)}{" "}
                    {recipe.servings === 1 ? "serving" : "servings"}
                  </span>
                  <span>
                    {recipe.versionCount}{" "}
                    {recipe.versionCount === 1 ? "version" : "versions"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">
          Start from a preset
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Link
              key={preset.id}
              href={`/recipes/new?preset=${preset.id}`}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-xs transition hover:border-accent/30"
            >
              <span className="font-medium">{preset.name}</span>
              <span className="block text-[11px] text-ink/40">{preset.blurb}</span>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink/35">
          Presets are templates. Saving one creates your own copy; editing it never changes the
          preset.
        </p>
      </section>
    </main>
  );
}
