import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeGenerator } from "@/components/recipe-generator";
import type { RecipePlan } from "@/lib/ai-generate-recipe";

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

beforeEach(() => {
  push.mockReset();
  previewRecipeFromPromptAction.mockReset();
  createRecipeFromPlanAction.mockReset();
  previewRecipeFromPromptAction.mockResolvedValue({ ok: true, plan: PLAN, resolutions: RESOLUTIONS });
  createRecipeFromPlanAction.mockResolvedValue({ ok: true, recipeId: "recipe-1" });
});

describe("create with AI: modal", () => {
  it("shows a disabled button instead of hiding when AI is off", () => {
    render(<RecipeGenerator aiEnabled={false} mode="create" />);
    expect(screen.getByRole("button", { name: /create with ai/i })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows where each ingredient comes from before anything is saved", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerator aiEnabled={true} mode="create" />);

    await user.click(screen.getByRole("button", { name: /create with ai/i }));
    await user.type(screen.getByRole("textbox"), "chicken biryani");
    await user.click(screen.getByRole("button", { name: /plan it/i }));

    expect(await screen.findByText(/where the ingredients come from/i)).toBeInTheDocument();
    expect(screen.getByText(/reusing Rice, raw milled/i)).toBeInTheDocument();
    expect(screen.getByText(/USDA import · Chicken/)).toBeInTheDocument();
    expect(screen.getByText(/provisional · all nutrients unknown/i)).toBeInTheDocument();

    expect(previewRecipeFromPromptAction).toHaveBeenCalledWith({ prompt: "chicken biryani", recipeId: null });
  });

  it("shows step and ingredient notes in the preview before anything is saved", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerator aiEnabled={true} mode="create" />);

    await user.click(screen.getByRole("button", { name: /create with ai/i }));
    await user.type(screen.getByRole("textbox"), "chicken biryani");
    await user.click(screen.getByRole("button", { name: /plan it/i }));

    expect(await screen.findByText(/Simmer until the grains are just tender/i)).toBeInTheDocument();
    expect(screen.getByText(/rinse until the water runs clear/i)).toBeInTheDocument();
  });

  it("saves with Add recipe only after confirmation, then navigates to it", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerator aiEnabled={true} mode="create" />);

    await user.click(screen.getByRole("button", { name: /create with ai/i }));
    await user.type(screen.getByRole("textbox"), "chicken biryani");
    await user.click(screen.getByRole("button", { name: /plan it/i }));
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

  it("edit mode: confirm says Save as new version and passes recipeId", async () => {
    const user = userEvent.setup();
    render(
      <RecipeGenerator
        aiEnabled={true}
        mode="edit"
        recipeId="r-9"
        versionId="v-3"
        versionNo={3}
        existingName="Biryani"
        saveMode="new-version"
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit with ai/i }));
    await user.type(screen.getByRole("textbox"), "make it spicier");
    await user.click(screen.getByRole("button", { name: /plan it/i }));
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
        mode="edit"
        recipeId="r-9"
        versionId="v-3"
        versionNo={3}
        saveMode="replace-current"
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit with ai/i }));
    await user.type(screen.getByRole("textbox"), "less salt");
    await user.click(screen.getByRole("button", { name: /plan it/i }));
    const confirm = await screen.findByRole("button", { name: /replace v3/i });
    await user.click(confirm);

    await waitFor(() => expect(createRecipeFromPlanAction).toHaveBeenCalledTimes(1));
    expect(createRecipeFromPlanAction.mock.calls[0][0]).toMatchObject({
      mode: "replace-current",
      replaceVersionId: "v-3",
    });
  });
});
