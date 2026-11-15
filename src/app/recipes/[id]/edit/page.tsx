import { notFound } from "next/navigation";
import { RecipeBuilder } from "@/components/recipe-builder";
import { listFoods } from "@/lib/db/foods";
import { getRecipe, getVersion } from "@/lib/db/recipes";
import { builderFromVersion } from "@/lib/recipe-draft";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const recipe = getRecipe(id);
  if (!recipe?.summary.currentVersionId) notFound();

  const version = getVersion(recipe.summary.currentVersionId);
  if (!version) notFound();

  return (
    <RecipeBuilder foods={listFoods()} initial={builderFromVersion(version)} recipeId={id} />
  );
}
