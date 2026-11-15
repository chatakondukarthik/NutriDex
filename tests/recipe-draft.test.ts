import { describe, expect, it } from "vitest";
import { FOODS } from "@/lib/data/foods";
import {
  builderFromDraft,
  builderFromVersion,
  builderToDraft,
  emptyBuilder,
  previewRecipe,
  type BuilderState,
} from "@/lib/recipe-draft";
import { prepareVersion } from "@/lib/recipe-validate";

function state(): BuilderState {
  return {
    name: "Test dish",
    versionLabel: "",
    instructions: "Cook it.",
    servings: "2",
    blocks: [
      {
        key: "b1",
        name: "Cook",
        operation: "fry",
        outputGrams: "250",
        inputs: [
          { key: "i1", foodId: "paneer", amount: "200", unitKey: "g", preparation: "crumbled", note: "" },
          { key: "i2", foodId: "mustard-oil", amount: "10", unitKey: "g", preparation: "", note: "" },
          {
            key: "i3",
            foodId: "salt",
            amount: "1",
            unitKey: "portion:1 pinch",
            preparation: "",
            note: "",
          },
        ],
      },
    ],
  };
}

describe("builder to draft", () => {
  it("converts the builder state into the shape the server validates", () => {
    const draft = builderToDraft(state());

    expect(draft.name).toBe("Test dish");
    expect(draft.servings).toBe(2);
    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0].outputGrams).toBe(250);
    expect(draft.blocks[0].inputs[2]).toMatchObject({
      foodId: "salt",
      amount: 1,
      unit: "portion",
      portionLabel: "1 pinch",
    });
  });

  it("drops rows where no food was chosen", () => {
    const withBlank = state();
    withBlank.blocks[0].inputs.push({
      key: "i4",
      foodId: "",
      amount: "100",
      unitKey: "g",
      preparation: "",
      note: "",
    });

    const draft = builderToDraft(withBlank);
    expect(draft.blocks[0].inputs).toHaveLength(3);
  });

  it("produces a draft the server accepts", () => {
    const prepared = prepareVersion(builderToDraft(state()));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.version.servings).toBe(2);
    expect(prepared.version.yieldGrams).toBe(250);
    expect(prepared.version.blocks[0].inputs[2].unit).toBe("portion:1 pinch");
    expect(prepared.version.snapshot.perServing.totals.ENERC_KCAL).toBeGreaterThan(0);
  });
});

describe("preview", () => {
  it("computes the same totals the server will store", () => {
    const preview = previewRecipe(state(), FOODS);
    const prepared = prepareVersion(builderToDraft(state()));

    expect(preview.result).not.toBeNull();
    expect(prepared.ok).toBe(true);
    if (!preview.result || !prepared.ok) return;

    expect(preview.result.total.totals.ENERC_KCAL).toBeCloseTo(
      prepared.version.snapshot.total.totals.ENERC_KCAL ?? 0,
      6,
    );
    expect(preview.result.yieldBasis).toBe("measured");
  });

  it("counts incomplete rows instead of treating them as zero", () => {
    const partial = state();
    partial.blocks[0].inputs[0].amount = "";

    const preview = previewRecipe(partial, FOODS);
    expect(preview.incomplete).toBe(1);
    // The remaining two ingredients still produce a total.
    expect(preview.result).not.toBeNull();
  });

  it("returns nothing when there is nothing valid to compute, and says why", () => {
    const preview = previewRecipe(emptyBuilder(), FOODS);
    expect(preview.result).toBeNull();
    expect(preview.problem).toBe("ingredients");
  });

  it("returns nothing when servings are invalid, and says why", () => {
    const invalid = state();
    invalid.servings = "0";
    const preview = previewRecipe(invalid, FOODS);
    expect(preview.result).toBeNull();
    expect(preview.problem).toBe("servings");
  });

  it("treats a blank servings field as a missing number, not zero", () => {
    const blank = state();
    blank.servings = "";
    expect(previewRecipe(blank, FOODS).problem).toBe("servings");
  });
});

describe("builder round trip", () => {
  it("rebuilds an equivalent builder from a stored version", () => {
    const draft = builderToDraft(state());
    const rebuilt = builderFromDraft(draft);
    const again = builderToDraft(rebuilt);

    expect(again.blocks).toHaveLength(draft.blocks.length);
    expect(again.blocks[0].inputs[2].portionLabel).toBe("1 pinch");
  });

  it("loads a stored version including its named portion and preparation", () => {
    const builder = builderFromVersion({
      id: "v1",
      recipeId: "r1",
      recipeName: "Stored",
      kind: "dish",
      versionNo: 3,
      label: "extra paneer",
      instructions: "Stir.",
      servings: 2,
      yieldGrams: 250,
      snapshot: {} as never,
      calculationVersion: "1",
      createdAt: "2026-11-14T00:00:00.000Z",
      blocks: [
        {
          id: "c1",
          name: "Cook",
          operation: "fry",
          outputGrams: 250,
          inputs: [
            {
              id: "i1",
              foodId: "paneer",
              grams: 200,
              amount: 1,
              unit: "portion:1 katori",
              preparation: "crumbled",
              note: null,
            },
          ],
        },
      ],
    });

    expect(builder.name).toBe("Stored");
    expect(builder.blocks[0].outputGrams).toBe("250");
    expect(builder.blocks[0].inputs[0]).toMatchObject({
      foodId: "paneer",
      amount: "1",
      unitKey: "portion:1 katori",
      preparation: "crumbled",
    });
  });
});
