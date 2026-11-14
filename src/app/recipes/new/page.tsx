import { RecipeBuilder } from "@/components/recipe-builder";
import { FOODS } from "@/lib/data/foods";
import { getPreset } from "@/lib/data/preset-recipes";
import { builderFromDraft, emptyBuilder } from "@/lib/recipe-draft";

export const dynamic = "force-dynamic";

export default async function NewRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const { preset: presetId } = await searchParams;
  const preset = getPreset(presetId);
  const initial = preset ? builderFromDraft(preset.draft) : emptyBuilder();

  return (
    <>
      {preset && (
        <div className="mx-auto max-w-4xl px-5 pt-5">
          <p className="rounded-xl border border-[#1f6f4a]/20 bg-[#1f6f4a]/5 px-3 py-2 text-[11px] text-[#1f6f4a]">
            Starting from <span className="font-semibold">{preset.name}</span>. Change anything —
            saving creates your own recipe.
          </p>
        </div>
      )}
      <RecipeBuilder foods={FOODS} initial={initial} recipeId={null} />
    </>
  );
}
