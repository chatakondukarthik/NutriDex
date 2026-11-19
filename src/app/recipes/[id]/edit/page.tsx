import { notFound } from "next/navigation";
import { FlowEditor } from "@/components/flow-editor";
import { aiStatus } from "@/lib/ai/client";
import { listFoods } from "@/lib/db/foods";
import {
  countVersionReferences,
  getRecipe,
  getVersion,
} from "@/lib/db/recipes";
import { graphFromBlocks, factorRows } from "@/lib/nutrition/graph-server";
import { builderFromVersion } from "@/lib/recipe-draft";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
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
  if (!versionId) notFound();

  const version = getVersion(versionId);
  if (!version || version.recipeId !== id) notFound();

  const references = countVersionReferences(version.id);

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
      <div className="mx-auto flex items-center justify-between gap-2 px-5 pt-4 text-[11px] text-ink/40">
        <span>
          {version.id === recipe.summary.currentVersionId ? "Editing" : "Editing older version"}{" "}
          <span className="font-medium text-ink/55">{version.recipeName}</span> · v{version.versionNo}
          {version.label && <span className="text-ink/35"> · {version.label}</span>}
        </span>
        <span className="hidden sm:inline">Changes are saved as a new version by default</span>
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
        versionId={version.id}
        versionNo={version.versionNo}
        replacePinned={references}
        aiAction={{ enabled: aiStatus().enabled }}
      />
    </>
  );
}
