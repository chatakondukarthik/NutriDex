import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EstimateWithAiButton } from "@/components/estimate-with-ai-button";

const push = vi.fn();
const refresh = vi.fn();
const estimateFoodNutrientsAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  estimateFoodNutrientsAction: (input: unknown) => estimateFoodNutrientsAction(input),
}));

describe("EstimateWithAiButton", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    estimateFoodNutrientsAction.mockReset();
    estimateFoodNutrientsAction.mockResolvedValue({ ok: true, filled: 3, message: "Filled 3 unknown nutrients with AI estimates." });
  });

  it("renders disabled with reason when AI is off", () => {
    render(<EstimateWithAiButton foodId="x" missingCount={12} aiEnabled={false} hasKey={true} />);
    expect(screen.getByRole("button", { name: /estimate.*missing with AI/i })).toBeDisabled();
  });

  it("renders disabled with reason when there is no key", () => {
    render(<EstimateWithAiButton foodId="x" missingCount={12} aiEnabled={true} hasKey={false} />);
    expect(screen.getByRole("button", { name: /estimate.*missing with AI/i })).toBeDisabled();
  });

  it("renders complete state when there is nothing to fill", () => {
    render(<EstimateWithAiButton foodId="x" missingCount={0} aiEnabled={true} hasKey={true} />);
    expect(screen.getByRole("button", { name: /estimate.*missing with AI/i })).toBeDisabled();
  });

  it("calls the action and shows the result, then refreshes", async () => {
    const user = userEvent.setup();
    render(<EstimateWithAiButton foodId="x" missingCount={12} aiEnabled={true} hasKey={true} />);
    await user.click(screen.getByRole("button", { name: /estimate.*missing with AI/i }));

    await waitFor(() => expect(estimateFoodNutrientsAction).toHaveBeenCalledWith("x"));
    expect(await screen.findByRole("status")).toHaveTextContent(/Filled 3 unknown/);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces failures instead of swallowing them", async () => {
    estimateFoodNutrientsAction.mockResolvedValue({ ok: false, message: "The model returned no values array." });
    const user = userEvent.setup();
    render(<EstimateWithAiButton foodId="x" missingCount={5} aiEnabled={true} hasKey={true} />);
    await user.click(screen.getByRole("button", { name: /estimate.*missing with AI/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/no values array/i);
  });
});
