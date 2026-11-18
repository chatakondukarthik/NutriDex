import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FoodDetailActions } from "@/components/food-detail-actions";
import type { NutrientCode } from "@/lib/nutrition/types";

const CODES: NutrientCode[] = ["PROCNT", "FE"];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  deleteCapturedFoodAction: vi.fn(),
  estimateFoodNutrientsAction: vi.fn(),
}));

const base = {
  foodId: "f1",
  foodName: "Test Food",
  isCaptured: true,
  missingCount: 2,
  missingCodes: CODES,
  aiEnabled: true,
  hasKey: true,
  source: "manual",
};

describe("FoodDetailActions", () => {
  it("row layout hides itself below sm and renders the compact actions", () => {
    const { container } = render(<FoodDetailActions {...base} layout="row" />);
    const row = container.firstElementChild!;
    expect(row.className).toContain("hidden");
    expect(row.className).toContain("sm:flex");
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
  });

  it("stack layout shows itself only below sm and stacks full-width", () => {
    const { container } = render(<FoodDetailActions {...base} layout="stack" />);
    const stack = container.firstElementChild!;
    expect(stack.className).toContain("sm:hidden");
    expect(stack.className).toContain("flex-col");
    // full-width touch targets, not inline chips
    expect(screen.getByRole("link", { name: "Edit" }).className).toContain("h-11");
    expect(screen.getByRole("link", { name: "Back" }).className).toContain("h-11");
  });

  it("renders no estimate or edit actions for a seed fixture food", () => {
    render(<FoodDetailActions {...base} layout="stack" isCaptured={false} source={undefined} />);
    expect(screen.queryByRole("button", { name: /estimate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
  });
});
