import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkEstimateButton } from "@/components/bulk-estimate-button";

const refresh = vi.fn();
const estimateFoodsAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  estimateFoodsAction: (input: unknown) => estimateFoodsAction(input),
}));

const PENDING = [
  { id: "f1", name: "Paneer (homemade)", captured: true, missing: 12 },
  { id: "f2", name: "Rice, raw milled", captured: false, missing: 3 },
];

describe("BulkEstimateButton", () => {
  beforeEach(() => {
    refresh.mockReset();
    estimateFoodsAction.mockReset();
    estimateFoodsAction.mockResolvedValue({
      ok: true,
      filled: 12,
      skipped: 0,
      failed: [],
      message: "Estimated 12 values across 1 food.",
    });
  });

  it("renders disabled with reason when AI is off", () => {
    render(
      <BulkEstimateButton pendingFoods={PENDING} selectedIds={new Set()} aiEnabled={false} hasKey={true} />,
    );
    expect(screen.getByRole("button", { name: /fill all with ai/i })).toBeDisabled();
  });

  it("renders disabled when nothing is missing anywhere", () => {
    render(
      <BulkEstimateButton pendingFoods={[]} selectedIds={new Set()} aiEnabled={true} hasKey={true} />,
    );
    expect(screen.getByRole("button", { name: /fill all with ai/i })).toBeDisabled();
  });

  it("opens the warning dialog and confirms with the captured food ids", async () => {
    const user = userEvent.setup();
    render(
      <BulkEstimateButton pendingFoods={PENDING} selectedIds={new Set()} aiEnabled={true} hasKey={true} />,
    );

    await user.click(screen.getByRole("button", { name: /fill all with ai \(1\)/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // only the captured food is listed; seed fixtures are always excluded
    expect(screen.getByText("Paneer (homemade)")).toBeInTheDocument();
    expect(screen.queryByText("Rice, raw milled")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/permanently/i);

    await user.click(screen.getByRole("button", { name: /yes, estimate 1 food/i }));
    await waitFor(() => expect(estimateFoodsAction).toHaveBeenCalledWith({ foodIds: ["f1"] }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("fills only the captured selection when some foods are selected", async () => {
    const user = userEvent.setup();
    render(
      <BulkEstimateButton pendingFoods={PENDING} selectedIds={new Set(["f1", "f2"])} aiEnabled={true} hasKey={true} />,
    );

    await user.click(screen.getByRole("button", { name: /fill selected with ai \(1\)/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Paneer (homemade)")).toBeInTheDocument();
    expect(screen.queryByText("Rice, raw milled")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /yes, estimate 1 food/i }));
    await waitFor(() => expect(estimateFoodsAction).toHaveBeenCalledWith({ foodIds: ["f1"] }));
  });
});
