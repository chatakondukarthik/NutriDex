import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkEstimateButton } from "@/components/bulk-estimate-button";

const refresh = vi.fn();
const estimateAllFoodsAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  estimateAllFoodsAction: () => estimateAllFoodsAction(),
}));

describe("BulkEstimateButton", () => {
  beforeEach(() => {
    refresh.mockReset();
    estimateAllFoodsAction.mockReset();
    estimateAllFoodsAction.mockResolvedValue({
      ok: true,
      filled: 132,
      skipped: 0,
      failed: [],
      message: "Estimated 132 values across 11 foods.",
    });
  });

  it("renders disabled with reason when AI is off", () => {
    render(<BulkEstimateButton pendingFoods={11} aiEnabled={false} hasKey={true} />);
    expect(screen.getByRole("button", { name: /fill all with ai/i })).toBeDisabled();
  });

  it("renders disabled when there is nothing missing", () => {
    render(<BulkEstimateButton pendingFoods={0} aiEnabled={true} hasKey={true} />);
    expect(screen.getByRole("button", { name: /fill all with ai/i })).toBeDisabled();
  });

  it("calls the batch action once, then refreshes", async () => {
    const user = userEvent.setup();
    render(<BulkEstimateButton pendingFoods={11} aiEnabled={true} hasKey={true} />);
    await user.click(screen.getByRole("button", { name: /fill all with ai \(11\)/i }));

    await waitFor(() => expect(estimateAllFoodsAction).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
