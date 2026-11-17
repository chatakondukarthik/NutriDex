import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanBoard } from "@/components/plan-board";
import { SEED_FOODS } from "@/lib/data/foods";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { targetsFor } from "@/lib/targets";
import type { PlanEntry } from "@/lib/plan";

/**
 * The plan board's keyboard path.
 *
 * A placed item can be dragged with a mouse, but a draggable element has
 * nothing to activate from the keyboard. The grip button therefore opens a
 * small day/meal dialog that calls the same `move` as a drop. These tests
 * pin that path: it opens, focus lands inside, Escape returns focus to the
 * grip, Tab wraps, and the move reaches the server action.
 */

const push = vi.fn();
const movePlanEntryAction = vi.fn();
const addPlanEntryAction = vi.fn();
const copyPlanDayAction = vi.fn();
const copyPlanWeekAction = vi.fn();
const removePlanEntryAction = vi.fn();
const updatePlanEntryQuantityAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  addPlanEntryAction: (input: unknown) => addPlanEntryAction(input),
  copyPlanDayAction: (day: string, target: string) => copyPlanDayAction(day, target),
  copyPlanWeekAction: (week: string, target: string) => copyPlanWeekAction(week, target),
  movePlanEntryAction: (input: unknown) => movePlanEntryAction(input),
  removePlanEntryAction: (id: string) => removePlanEntryAction(id),
  updatePlanEntryQuantityAction: (input: unknown) => updatePlanEntryQuantityAction(input),
}));

const WEEK = "2026-11-16";

const ENTRY: PlanEntry = {
  id: "e1",
  planId: "p1",
  day: WEEK,
  slot: "lunch",
  position: 0,
  foodId: "paneer",
  recipeVersionId: null,
  grams: 100,
  amount: 100,
  unit: "g",
  servings: null,
};

function setup(entries: PlanEntry[] = [ENTRY]) {
  const user = userEvent.setup();
  render(
    <PlanBoard
      week={WEEK}
      today={WEEK}
      foods={SEED_FOODS}
      recipes={[]}
      entries={entries}
      targets={targetsFor(DEFAULT_PROFILE)}
      profileIsDefault={false}
    />,
  );
  return user;
}

/** The week is rendered twice (single-day below xl, seven columns above). */
function grips() {
  return screen.getAllByRole("button", { name: /move paneer to another day or meal/i });
}

beforeEach(() => {
  push.mockReset();
  for (const action of [
    movePlanEntryAction,
    addPlanEntryAction,
    copyPlanDayAction,
    copyPlanWeekAction,
    removePlanEntryAction,
    updatePlanEntryQuantityAction,
  ]) {
    action.mockReset();
  }
  movePlanEntryAction.mockResolvedValue({ ok: true });
});

describe("moving a placed item from the keyboard", () => {
  it("opens a dialog from the grip button", async () => {
    const user = setup();
    await user.click(grips()[0]);

    const dialog = screen.getByRole("dialog", { name: /move “paneer”/i });
    expect(within(dialog).getByLabelText("Day")).toHaveValue(WEEK);
    expect(within(dialog).getByLabelText("Meal")).toHaveValue("lunch");
  });

  it("moves focus into the dialog", async () => {
    const user = setup();
    await user.click(grips()[0]);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Day")),
    );
  });

  it("sends the chosen day and meal to the same action as a drop", async () => {
    const user = setup();
    await user.click(grips()[0]);

    await user.selectOptions(screen.getByLabelText("Day"), "2026-11-17");
    await user.selectOptions(screen.getByLabelText("Meal"), "dinner");
    await user.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(movePlanEntryAction).toHaveBeenCalledWith({
        week: WEEK,
        id: "e1",
        day: "2026-11-17",
        slot: "dinner",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps Move disabled until something changes", async () => {
    const user = setup();
    await user.click(grips()[0]);

    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Meal"), "snack");
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
  });

  it("closes on Escape and returns focus to the grip", async () => {
    const user = setup();
    const grip = grips()[0];
    await user.click(grip);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(grip));
    expect(movePlanEntryAction).not.toHaveBeenCalled();
  });

  it("wraps Tab inside the dialog", async () => {
    const user = setup();
    await user.click(grips()[0]);

    // The last focusable is Cancel (Move is disabled while unchanged).
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Day"));

    screen.getByLabelText("Day").focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });
});
