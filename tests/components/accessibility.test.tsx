import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { RecipeBuilder } from "@/components/recipe-builder";
import { SEED_FOODS } from "@/lib/data/foods";
import { emptyBuilder } from "@/lib/recipe-draft";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  saveRecipeAction: vi.fn(),
}));

/**
 * Accessibility checks.
 *
 * jsdom has no layout, so contrast rules are off; every structural rule
 * (names, roles, labels, landmarks, focus order) still runs. These are the
 * rules a keyboard or screen-reader user depends on and the ones most likely
 * to regress when a component is rewritten.
 */
async function violationsOf(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
      "color-contrast-enhanced": { enabled: false },
      // The component is rendered without the app shell in these tests.
      region: { enabled: false },
    },
  });

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

function renderBuilder() {
  const user = userEvent.setup();
  const view = render(<RecipeBuilder foods={SEED_FOODS} initial={emptyBuilder()} recipeId={null} />);
  return { user, container: view.container };
}

async function choosePaneer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /choose a food/i }));
  await user.click(await screen.findByRole("option", { name: /paneer/i }));
}

describe("recipe builder accessibility", () => {
  it("has no structural violations on the ingredient step", async () => {
    const { container } = renderBuilder();
    expect(await violationsOf(container)).toEqual([]);
  });

  it("has no structural violations with the food picker open", async () => {
    const { user, container } = renderBuilder();

    await user.click(screen.getByRole("button", { name: /choose a food/i }));

    expect(await violationsOf(container)).toEqual([]);
  });

  it("has no structural violations after a food is chosen", async () => {
    const { user, container } = renderBuilder();

    await choosePaneer(user);

    expect(await violationsOf(container)).toEqual([]);
  });

  it("has no structural violations on the review step", async () => {
    const { user, container } = renderBuilder();

    await user.type(screen.getByRole("textbox", { name: /recipe name/i }), "Test sabzi");
    await choosePaneer(user);
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(await violationsOf(container)).toEqual([]);
  });
});
