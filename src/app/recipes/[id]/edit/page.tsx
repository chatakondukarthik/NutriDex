import { notFound } from "next/navigation";
import { FlowEditor } from "@/components/flow-editor";
import { RecipeGenerator } from "@/components/recipe-generator";
import { aiStatus } from "@/lib/ai/client";
import { listFoods, getFood } from "@/lib/db/foods";
import { getRecipe, getVersion } from "@/lib/db/recipes";
import { graphFromBlocks, factorRows } from "@/lib/nutrition/graph-server";
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

  const foods = listFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));

  const stored = (version.snapshot as unknown as { graph?: { nodes: never; edges: never }; layout?: never });
  const storedGraph = stored?.graph ?? null;

  const graph = storedGraph ?? (() => {
    const builder = builderFromVersion(version);
    return graphFromBlocks(builder.blocks, foodMap);
  })();

  return (
    <>
      <div className="mx-auto flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <p className="text-[11px] text-ink/40">
          Editing {version.recipeName} · v{version.versionNo}
        </p>
        <RecipeGenerator
          aiEnabled={aiStatus().enabled}
          mode="edit"
          recipeId={id}
          existingName={version.recipeName}
        />
      </div>
      <FlowEditor
        foods={foods}
        factorRows={factorRows()}
        recipeId={id}
        initialGraph={graph as never}
        initialLayout={(stored as { layout?: Record<string, { x: number; y: number }> }).layout}
        initialName={version.recipeName}
        initialInstructions={version.instructions}
        initialServings={String(version.servings)}
        initialVersionLabel=""
      />
    </>
  );
}
