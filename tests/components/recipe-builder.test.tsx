import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeBuilder } from "@/components/recipe-builder";
import { FOODS } from "@/lib/data/foods";
import { emptyBuilder } from "@/lib/recipe-draft";

const push = vi.fn();
const saveRecipeAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  saveRecipeAction: (draft: unknown) => saveRecipeAction(draft),
}));

function setup() {
  const user = userEvent.setup();
  render(<RecipeBuilder foods={FOODS} initial={emptyBuilder()} recipeId={null} />);
  return user;
}

const removeButtons = () => screen.queryAllByRole("button", { name: /remove ingredient/i });
const foodTriggers = () => screen.queryAllByRole("button", { name: /choose a food/i });
// The unit `<select>` also maps to the combobox role, so identify the search
// field by its placeholder instead.
const searchBox = () => screen.queryByPlaceholderText(/paneer, palak, dal/i);
const searchBoxes = () => screen.queryAllByPlaceholderText(/paneer, palak, dal/i);

async function addIngredient(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /add ingredient/i }));
}

async function pickFood(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("button", { name: /choose a food/i }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("recipe builder: ingredient rows", () => {
  beforeEach(() => {
    push.mockReset();
    saveRecipeAction.mockReset();
  });

  it("starts with one empty row and an enabled remove button", async () => {
    setup();

    expect(removeButtons()).toHaveLength(1);
    expect(removeButtons()[0]).toBeEnabled();
    expect(foodTriggers()).toHaveLength(1);
  });

  it("adds and removes ingredient rows", async () => {
    const user = setup();

    await addIngredient(user);
    expect(removeButtons()).toHaveLength(2);

    await user.click(removeButtons()[0]);
    expect(removeButtons()).toHaveLength(1);
  });

  it("keeps one row when the last ingredient is removed", async () => {
    const user = setup();

    await pickFood(user, /paneer/i);
    expect(screen.queryByRole("button", { name: /choose a food/i })).not.toBeInTheDocument();

    await user.click(removeButtons()[0]);

    // The row is cleared rather than deleted, so there is still somewhere to
    // choose a food. This is the regression that made ingredients undeletable.
    expect(removeButtons()).toHaveLength(1);
    expect(foodTriggers()).toHaveLength(1);
  });
});

describe("recipe builder: food picker", () => {
  beforeEach(() => {
    push.mockReset();
    saveRecipeAction.mockReset();
  });

  it("opens on click and closes on an outside pointer press", async () => {
    const user = setup();

    await user.click(foodTriggers()[0]);
    expect(searchBox()).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Ingredients" }));

    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = setup();

    await user.click(foodTriggers()[0]);
    expect(searchBox()).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /choose a food/i })).toHaveFocus();
  });

  it("closes after a food is chosen and shows the selection", async () => {
    const user = setup();

    await user.click(foodTriggers()[0]);
    await user.click(await screen.findByRole("option", { name: /paneer/i }));

    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /paneer/i })).toBeInTheDocument();
  });

  it("only keeps one picker open at a time", async () => {
    const user = setup();

    await addIngredient(user);
    expect(foodTriggers()).toHaveLength(2);

    await user.click(foodTriggers()[0]);
    expect(searchBox()).toBeInTheDocument();

    // While one picker is open its trigger is replaced by the search input, so
    // the remaining trigger is the other row's.
    await user.click(foodTriggers()[0]);

    await waitFor(() => expect(searchBoxes()).toHaveLength(1));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
  });

  it("supports keyboard selection with arrow keys and Enter", async () => {
    const user = setup();

    await user.click(foodTriggers()[0]);
    const input = searchBox()!;
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.type(input, "paneer");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /paneer/i })).toBeInTheDocument();
  });

  it("filters results and says when nothing matches", async () => {
    const user = setup();

    await user.click(foodTriggers()[0]);
    await user.type(searchBox()!, "zzzzz");

    expect(screen.getByText(/no match in the food list/i)).toBeInTheDocument();
  });
});

describe("recipe builder: steps and saving", () => {
  beforeEach(() => {
    push.mockReset();
    saveRecipeAction.mockReset();
  });

  it("moves between steps and back", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Method" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Ingredients" })).toBeInTheDocument();
  });

  it("keeps the save button disabled until the recipe is complete", async () => {
    const user = setup();

    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }

    const save = screen.getByRole("button", { name: /save recipe/i });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Ingredients" }));
    await user.type(screen.getByRole("textbox", { name: /recipe name/i }), "Test sabzi");
    await pickFood(user, /paneer/i);

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: /save recipe/i })).toBeEnabled();
  });

  it("sends the draft to the server action and navigates on success", async () => {
    saveRecipeAction.mockResolvedValue({
      ok: true,
      recipeId: "recipe-1",
      versionId: "version-1",
      versionNo: 1,
    });

    const user = setup();

    await user.type(screen.getByRole("textbox", { name: /recipe name/i }), "Test sabzi");
    await pickFood(user, /paneer/i);

    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.click(screen.getByRole("button", { name: /save recipe/i }));

    await waitFor(() => expect(saveRecipeAction).toHaveBeenCalledTimes(1));
    const draft = saveRecipeAction.mock.calls[0][0] as { name: string };
    expect(draft.name).toBe("Test sabzi");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/recipes/recipe-1"));
  });

  it("shows the server error and stays on the page", async () => {
    saveRecipeAction.mockResolvedValue({ ok: false, message: "Something went wrong" });

    const user = setup();

    await user.type(screen.getByRole("textbox", { name: /recipe name/i }), "Test sabzi");
    await pickFood(user, /paneer/i);

    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.click(screen.getByRole("button", { name: /save recipe/i }));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
