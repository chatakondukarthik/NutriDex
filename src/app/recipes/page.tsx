import Link from "next/link";
import { PRESETS } from "@/lib/data/preset-recipes";
import { listRecipes, listRecipeIngredientIds, countLegacyRecipes } from "@/lib/db/recipes";
import { listFoods } from "@/lib/db/foods";
import { ConvertRecipesButton } from "@/components/convert-recipes-button";
import { RecipesBrowser } from "@/components/recipes-browser";

export const dynamic = "force-dynamic";

export default function RecipesPage() {
  const recipes = listRecipes();
  const ingredientIds = listRecipeIngredientIds();
  const foods = listFoods();

  const foodById = new Map(foods.map((f) => [f.id, f]));
  const enriched = recipes.map((recipe) => {
    const ids = ingredientIds.get(recipe.id) ?? [];
    const resolved = ids
      .map((id) => foodById.get(id))
      .filter((food) => food != null)
      .map((food) => ({ id: food.id, name: food.name }));
    const terms = ids.flatMap((id) => {
      const food = foodById.get(id);
      return food ? [food.name, ...(food.aliases ?? [])] : [];
    });
    return {
      ...recipe,
      ingredientIds: ids,
      ingredients: resolved.map((food) => ({ id: food.id, name: food.name })),
      haystack: `${recipe.name} ${terms.join(" ")}`.toLowerCase(),
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recipes</h1>
          <p className="mt-1 text-xs text-ink/45">
            Every save is a new version. Old versions stay exactly as they were.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {countLegacyRecipes() > 0 && <ConvertRecipesButton legacyCount={countLegacyRecipes()} />}
          <Link
            href="/recipes/new"
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition hover:bg-accent-strong"
          >
            New recipe
          </Link>
        </div>
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
        <RecipesBrowser recipes={enriched} />
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
