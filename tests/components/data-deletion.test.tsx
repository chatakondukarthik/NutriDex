import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataDeletionPanel } from "@/components/data-deletion";
import type { PurgePreview } from "@/lib/db/purge";

/**
 * The deletion panel's safety rules:
 *
 *   1. only categories that exist are selectable;
 *   2. a blocker keeps the destructive button disabled and says which
 *      category must be selected too;
 *   3. the confirmation needs an explicit acknowledgement before the server
 *      is called, and the request carries only the selected ids;
 *   4. a refusal from the server is shown without pretending anything was
 *      deleted, and a success refreshes the counts.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const purgeDataAction = vi.fn();

vi.mock("@/app/actions", () => ({
  purgeDataAction: (...args: unknown[]) => purgeDataAction(...args),
}));

function preview(overrides: Partial<Record<string, number>> = {}): PurgePreview {
  const counts = {
    diary: 2,
    plans: 0,
    recipes: 0,
    foods: 1,
    defaults: 0,
    profile: 1,
    preferences: 1,
    ai: 0,
    ...overrides,
  };

  return {
    categories: [
      {
        id: "diary",
        label: "Diary entries",
        unit: "entry",
        description: "Every food and recipe you logged, across every day.",
        count: counts.diary,
        blockers: [],
      },
      {
        id: "plans",
        label: "Weekly plans",
        unit: "plan",
        description: "Plans and every meal placed in them.",
        count: counts.plans,
        blockers: [],
      },
      {
        id: "recipes",
        label: "Recipes",
        unit: "recipe",
        description: "Recipes, their versions, blocks and ingredient lines.",
        count: counts.recipes,
        blockers: [],
      },
      {
        id: "foods",
        label: "Foods you created",
        unit: "food",
        description: "Foods you added and their nutrients.",
        count: counts.foods,
        blockers:
          counts.foods > 0
            ? [{ category: "diary", label: "Diary entries", unit: "entry", count: 1 }]
            : [],
      },
      {
        id: "defaults",
        label: "Saved default amounts",
        unit: "default",
        description: "Pinned amounts and units for foods.",
        count: counts.defaults,
        blockers: [],
      },
      {
        id: "profile",
        label: "Profile",
        unit: "profile",
        description: "Body and goal inputs.",
        count: counts.profile,
        blockers: [],
      },
      {
        id: "preferences",
        label: "Settings and overrides",
        unit: "setting",
        description: "AI instructions, thresholds and retention overrides.",
        count: counts.preferences,
        blockers: [],
      },
      {
        id: "ai",
        label: "AI activity log",
        unit: "record",
        description: "The AI call log and cached estimates.",
        count: counts.ai,
        blockers: [],
      },
    ],
  };
}

function success(previewAfter = preview({ diary: 0, foods: 0, profile: 0, preferences: 0 })) {
  return {
    ok: true as const,
    deleted: { diary: 2, foods: 1, profile: 1, preferences: 1 },
    filesRemoved: 1,
    warnings: [] as string[],
    preview: previewAfter,
  };
}

beforeEach(() => {
  purgeDataAction.mockReset();
  refresh.mockReset();
});

describe("selection", () => {
  it("disables categories with nothing to delete", () => {
    render(<DataDeletionPanel initialPreview={preview()} />);

    expect(screen.getByRole("checkbox", { name: /Diary entries/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Weekly plans/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Recipes/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /AI activity log/ })).toBeDisabled();
  });

  it("selects only non-empty categories and reports the total", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    const all = screen.getByRole("checkbox", { name: /Select everything/ });
    await user.click(all);

    expect(screen.getByRole("checkbox", { name: /Diary entries/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Profile/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Weekly plans/ })).not.toBeChecked();
    expect(screen.getByText("4 categories · 5 items")).toBeInTheDocument();
  });

  it("shows the indeterminate state for a partial selection", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    const all = screen.getByRole("checkbox", { name: /Select everything/ }) as HTMLInputElement;
    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));

    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it("drops a selection when the server sends a new preview", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    expect(screen.getByRole("checkbox", { name: /Diary entries/ })).toBeChecked();

    rerender(<DataDeletionPanel initialPreview={preview({ diary: 2 })} />);

    expect(screen.getByRole("checkbox", { name: /Diary entries/ })).not.toBeChecked();
  });

  it("keeps delete disabled while a selected parent is still referenced", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Foods you created/ }));

    expect(screen.getByRole("button", { name: /Delete selected data/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Diary entries still reference/i);
  });
});

describe("confirmation", () => {
  it("requires the acknowledgement before calling the server", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));

    const permanently = screen.getByRole("button", { name: /Delete permanently/ });
    expect(permanently).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /I understand/ })).toHaveFocus();

    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    expect(permanently).toBeEnabled();
    expect(purgeDataAction).not.toHaveBeenCalled();
  });

  it("cancelling drops the acknowledgement and keeps the selection", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Cancel/ }));

    expect(screen.getByRole("button", { name: /Delete selected data/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    expect(screen.getByRole("button", { name: /Delete permanently/ })).toBeDisabled();
  });

  it("returns focus to the trigger on cancel and on Escape", async () => {
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    expect(screen.getByRole("checkbox", { name: /I understand/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /Delete selected data/ })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(screen.getByRole("button", { name: /Delete selected data/ })).toHaveFocus();
  });

  it("moves focus to the result after a successful delete", async () => {
    purgeDataAction.mockResolvedValue(success());
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    const result = await screen.findByText("Deleted.");
    await waitFor(() => expect(result.parentElement).toHaveFocus());
  });

  it("returns focus to the trigger when the server refuses", async () => {
    purgeDataAction.mockResolvedValue({
      ok: false,
      message: "That data is still used by Diary entries.",
      preview: preview(),
    });
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Delete selected data/ })).toHaveFocus(),
    );
  });

  it("sends only the selected categories and reports what was deleted", async () => {
    purgeDataAction.mockResolvedValue(success());
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("checkbox", { name: /Foods you created/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    await waitFor(() => expect(purgeDataAction).toHaveBeenCalledWith(["diary", "foods"]));
    expect(await screen.findByText("Deleted.")).toBeInTheDocument();
    expect(screen.getByText(/2 entries/)).toBeInTheDocument();
    expect(screen.getByText(/1 evidence image/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    // The refreshed preview has no user rows left, so the controls are gone.
    expect(screen.getByText(/There is no user data to delete/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Diary entries/ })).not.toBeInTheDocument();
  });

  it("shows a server refusal without claiming success", async () => {
    purgeDataAction.mockResolvedValue({
      ok: false,
      message: "That data is still used by Diary entries. Select that category too.",
      blocked: ["foods"],
      blockers: [{ category: "diary", label: "Diary entries", unit: "entry", count: 1 }],
      preview: preview(),
    });
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("checkbox", { name: /Foods you created/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/still used by Diary entries/i);
    expect(screen.queryByText("Deleted.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Diary entries/ })).toBeChecked();
  });

  it("surfaces a warning when an evidence file could not be removed", async () => {
    purgeDataAction.mockResolvedValue({
      ...success(),
      warnings: ["1 evidence image could not be removed. Check data/evidence."],
    });
    const user = userEvent.setup();
    render(<DataDeletionPanel initialPreview={preview()} />);

    await user.click(screen.getByRole("checkbox", { name: /Diary entries/ }));
    await user.click(screen.getByRole("checkbox", { name: /Foods you created/ }));
    await user.click(screen.getByRole("button", { name: /Delete selected data/ }));
    await user.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await user.click(screen.getByRole("button", { name: /Delete permanently/ }));

    expect(await screen.findByText(/could not be removed/i)).toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("says there is nothing to delete instead of showing dead controls", () => {
    render(
      <DataDeletionPanel
        initialPreview={preview({
          diary: 0,
          plans: 0,
          recipes: 0,
          foods: 0,
          defaults: 0,
          profile: 0,
          preferences: 0,
          ai: 0,
        })}
      />,
    );

    expect(screen.getByText(/There is no user data to delete/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
