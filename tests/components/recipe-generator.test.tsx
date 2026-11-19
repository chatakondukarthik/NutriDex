import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeGenerator } from "@/components/recipe-generator";
import type { RecipePlan } from "@/lib/ai-generate-recipe";
import type { Graph } from "@/lib/nutrition/graph";

const push = vi.fn();
const previewRecipeFromPromptAction = vi.fn();
const createRecipeFromPlanAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  previewRecipeFromPromptAction: (input: unknown) => previewRecipeFromPromptAction(input),
  createRecipeFromPlanAction: (input: unknown) => createRecipeFromPlanAction(input),
}));

const PLAN: RecipePlan = {
  name: "Chicken biryani",
  servings: 4,
  instructions: "Layer and dum cook.",
  steps: [
    {
      name: "Cook rice",
      operation: "boil",
      inputs: [{ foodName: "Rice", grams: 300, note: "rinse until the water runs clear" }],
      note: "Simmer until the grains are just tender.",
    },
    {
      name: "Marinate chicken",
      operation: "marinate",
      inputs: [{ foodName: "Chicken thigh", grams: 500 }],
    },
  ],
};

const RESOLUTIONS = [
  { name: "Rice", status: "reused" as const, foodId: "rice-id", matchedName: "Rice, raw milled", score: 1 },
  { name: "Chicken thigh", status: "usda-import" as const, foodId: null, matchedName: "Chicken, thigh, meat only, raw", score: 1, fdcId: 171111 },
  { name: "Drumstick leaves", status: "provisional" as const, foodId: null, matchedName: null, score: null },
];

const EMPTY_CANVAS = {
  name: "",
  instructions: "",
  servings: "2",
  graph: { nodes: [], edges: [] } as Graph,
};

const BIRYANI_CANVAS = {
  name: "Biryani",
  instructions: "",
  servings: "2",
  graph: {
    nodes: [
      {
        id: "n1",
        type: "process" as const,
        operation: "assemble",
        name: "Build it",
        outputs: [{ label: "out", tag: "consumed" as const, split: {} }],
      },
    ],
    edges: [],
  } as Graph,
};

beforeEach(() => {
  push.mockReset();
  previewRecipeFromPromptAction.mockReset();
  createRecipeFromPlanAction.mockReset();
  previewRecipeFromPromptAction.mockResolvedValue({ ok: true, plan: PLAN, resolutions: RESOLUTIONS });
  createRecipeFromPlanAction.mockResolvedValue({ ok: true, recipeId: "recipe-1" });
});

describe("the AI recipe dialog", () => {
  it("renders nothing when AI is off", () => {
    const { container } = render(<RecipeGenerator aiEnabled={false} canvas={EMPTY_CANVAS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on a bar command and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerator aiEnabled={true} canvas={EMPTY_CANVAS} command={{ seq: 1, prompt: "chicken biryani" }} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows where each ingredient comes from before anything is saved", async () => {
    render(<RecipeGenerator aiEnabled={true} canvas={EMPTY_CANVAS} command={{ seq: 1, prompt: "chicken biryani" }} />);

    expect(await screen.findByText(/where the ingredients come from/i)).toBeInTheDocument();
    expect(screen.getByText(/reusing Rice, raw milled/i)).toBeInTheDocument();
    expect(screen.getByText(/USDA import · Chicken/)).toBeInTheDocument();
    expect(screen.getByText(/provisional · all nutrients unknown/i)).toBeInTheDocument();

    expect(previewRecipeFromPromptAction).toHaveBeenCalledWith({
      prompt: "chicken biryani",
      recipeId: null,
      context: null,
      images: undefined,
    });
  });

  it("shows step and ingredient notes in the preview before anything is saved", async () => {
    render(<RecipeGenerator aiEnabled={true} canvas={EMPTY_CANVAS} command={{ seq: 1, prompt: "chicken biryani" }} />);

    expect(await screen.findByText(/Simmer until the grains are just tender/i)).toBeInTheDocument();
    expect(screen.getByText(/rinse until the water runs clear/i)).toBeInTheDocument();
  });

  it("an occupied canvas sends the live graph, not the saved snapshot", async () => {
    render(
      <RecipeGenerator
        aiEnabled={true}
        canvas={BIRYANI_CANVAS}
        command={{ seq: 1, prompt: "make it spicier" }}
      />,
    );

    await screen.findByText(/where the ingredients come from/i);
    expect(previewRecipeFromPromptAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "make it spicier",
        recipeId: null,
        context: {
          name: "Biryani",
          instructions: "",
          servings: 2,
          graph: BIRYANI_CANVAS.graph,
        },
      }),
    );
  });

  it("saves with Add recipe only after confirmation, then navigates to it", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerator aiEnabled={true} canvas={EMPTY_CANVAS} command={{ seq: 1, prompt: "chicken biryani" }} />);

    const confirm = await screen.findByRole("button", { name: /^add recipe$/i });
    await user.click(confirm);

    await waitFor(() => expect(createRecipeFromPlanAction).toHaveBeenCalledTimes(1));
    expect(createRecipeFromPlanAction.mock.calls[0][0]).toMatchObject({
      name: "Chicken biryani",
      recipeId: null,
      mode: "new-version",
    });
    expect(push).toHaveBeenCalledWith("/recipes/recipe-1");
  });

  it("edit mode: confirm says Save as new version and saves against the recipe", async () => {
    const user = userEvent.setup();
    render(
      <RecipeGenerator
        aiEnabled={true}
        canvas={BIRYANI_CANVAS}
        command={{ seq: 1, prompt: "make it spicier" }}
        recipeId="r-9"
        versionId="v-3"
        versionNo={3}
        saveMode="new-version"
      />,
    );

    const confirm = await screen.findByRole("button", { name: /save as new version/i });
    await user.click(confirm);

    await waitFor(() => expect(createRecipeFromPlanAction).toHaveBeenCalledTimes(1));
    expect(createRecipeFromPlanAction.mock.calls[0][0]).toMatchObject({
      recipeId: "r-9",
      mode: "new-version",
      replaceVersionId: null,
    });
  });

  it("edit mode with replace armed: confirm says Replace v3 and passes replaceVersionId", async () => {
    const user = userEvent.setup();
    render(
      <RecipeGenerator
        aiEnabled={true}
        canvas={BIRYANI_CANVAS}
        command={{ seq: 1, prompt: "less salt" }}
        recipeId="r-9"
        versionId="v-3"
        versionNo={3}
        saveMode="replace-current"
      />,
    );

    // Both the segmented control and the footer confirm read "Replace v3" —
    // wait for the plan to land (two matches), then click the footer one.
    await waitFor(() => expect(screen.getAllByRole("button", { name: /replace v3/i })).toHaveLength(2));
    await user.click(screen.getAllByRole("button", { name: /replace v3/i })[1]);

    await waitFor(() => expect(createRecipeFromPlanAction).toHaveBeenCalledTimes(1));
    expect(createRecipeFromPlanAction.mock.calls[0][0]).toMatchObject({
      mode: "replace-current",
      replaceVersionId: "v-3",
    });
  });
});
