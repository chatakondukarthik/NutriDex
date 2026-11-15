import { FlowEditor } from "@/components/flow-editor";
import { aiStatus } from "@/lib/ai/client";
import { listFoods } from "@/lib/db/foods";
import { graphFromBlocks, factorRows } from "@/lib/nutrition/graph-server";
import { getPreset } from "@/lib/data/preset-recipes";
import { builderFromDraft } from "@/lib/recipe-draft";

export const dynamic = "force-dynamic";

export default async function NewRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const { preset: presetId } = await searchParams;
  const preset = getPreset(presetId);
  const foods = listFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));
  const initialGraph = preset ? graphFromBlocks(builderFromDraft(preset.draft).blocks, foodMap) : null;

  return (
    <>
      {preset && (
        <div className="mx-auto max-w-4xl px-5 pt-5">
          <p className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-[11px] text-accent">
            Starting from <span className="font-semibold">{preset.name}</span>. Change anything —
            saving creates your own recipe.
          </p>
        </div>
      )}
      <FlowEditor
        foods={foods}
        factorRows={factorRows()}
        recipeId={null}
        initialGraph={initialGraph}
        initialName={preset?.name ?? ""}
        aiAction={{ enabled: aiStatus().enabled, mode: "create" }}
      />
    </>
  );
}
