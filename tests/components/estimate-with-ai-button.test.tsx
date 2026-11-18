import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EstimateWithAiButton } from "@/components/estimate-with-ai-button";
import type { NutrientCode } from "@/lib/nutrition/types";

const CODES: NutrientCode[] = ["PROCNT", "FE", "CA"];

const push = vi.fn();
const refresh = vi.fn();
const estimateFoodNutrientsAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  estimateFoodNutrientsAction: (...args: unknown[]) => estimateFoodNutrientsAction(...args),
}));

function renderButton(extra: Partial<Parameters<typeof EstimateWithAiButton>[0]> = {}) {
  return render(
    <EstimateWithAiButton
      foodId="x"
      foodName="Test Food"
      missingCount={3}
      missingCodes={CODES}
      aiEnabled={true}
      hasKey={true}
      {...extra}
    />,
  );
}

describe("EstimateWithAiButton", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    estimateFoodNutrientsAction.mockReset();
    estimateFoodNutrientsAction.mockResolvedValue({ ok: true, filled: 3, message: "Filled 3 unknown nutrients with AI estimates." });
  });

  it("renders disabled with reason when AI is off", () => {
    renderButton({ aiEnabled: false });
    expect(screen.getByRole("button", { name: /estimate.*missing with ai/i })).toBeDisabled();
  });

  it("renders disabled with reason when there is no key", () => {
    renderButton({ hasKey: false });
    expect(screen.getByRole("button", { name: /estimate.*missing with ai/i })).toBeDisabled();
  });

  it("renders complete state when there is nothing to fill", () => {
    renderButton({ missingCount: 0, missingCodes: [] });
    expect(screen.getByRole("button", { name: /estimate.*missing with ai/i })).toBeDisabled();
  });

  it("opens a modal instead of expanding in place", async () => {
    const user = userEvent.setup();
    renderButton();

    // No estimate until the user confirms in the dialog.
    await user.click(screen.getByRole("button", { name: /estimate.*missing with ai/i }));
    expect(estimateFoodNutrientsAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/Test Food/);
    expect(screen.getByRole("dialog")).toHaveTextContent(/every recipe, plan and diary entry/i);
  });

  it("confirms with the selected nutrients only", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: /estimate.*missing with ai/i }));
    // Deselect one nutrient, keep the rest.
    await user.click(screen.getByRole("checkbox", { name: /copper|iron/i }));
    await user.click(screen.getByRole("button", { name: /yes, estimate/i }));

    await waitFor(() => expect(estimateFoodNutrientsAction).toHaveBeenCalledWith("x", ["PROCNT", "CA"]));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cancelling the modal makes no call", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: /estimate.*missing with ai/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(estimateFoodNutrientsAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tells a USDA-sourced food that its measured values stay untouched", async () => {
    const user = userEvent.setup();
    renderButton({ source: "usda" });

    await user.click(screen.getByRole("button", { name: /estimate.*missing with ai/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/USDA never measured/i);
  });

  it("surfaces failures instead of swallowing them", async () => {
    estimateFoodNutrientsAction.mockResolvedValue({ ok: false, message: "The model returned no values array." });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: /estimate.*missing with ai/i }));
    await user.click(screen.getByRole("button", { name: /yes, estimate/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/no values array/i);
  });
});
