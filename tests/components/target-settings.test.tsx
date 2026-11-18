import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TargetSettingsPanel } from "@/components/target-settings";
import { fmt } from "@/lib/format";
import { DEFAULT_PROFILE } from "@/lib/profile";
import {
  DEFAULT_TARGET_RULES,
  targetsFor,
  type TargetRules,
} from "@/lib/targets";

/**
 * The settings panel is the only place the colour rules can be changed.
 *
 * It must show the stored values, send a parsed payload, keep red at or
 * above amber, and make "clear the override" mean "go back to the profile
 * recommendation" rather than "set the target to zero".
 */

const saveTargetRulesAction = vi.fn();
const resetTargetRulesAction = vi.fn();

vi.mock("@/app/actions", () => ({
  saveTargetRulesAction: (rules: unknown, personId: unknown) =>
    saveTargetRulesAction(rules, personId),
  resetTargetRulesAction: (personId: unknown) => resetTargetRulesAction(personId),
}));

const recommended = targetsFor(DEFAULT_PROFILE);

function setup(initial: TargetRules = DEFAULT_TARGET_RULES) {
  const user = userEvent.setup();
  render(
    <TargetSettingsPanel
      personId="person-1"
      personName="Priya"
      initial={initial}
      recommended={recommended}
    />,
  );
  return user;
}

beforeEach(() => {
  saveTargetRulesAction.mockReset();
  resetTargetRulesAction.mockReset();
  saveTargetRulesAction.mockImplementation(async (rules: TargetRules) => ({
    ok: true,
    rules,
  }));
  resetTargetRulesAction.mockResolvedValue({ ok: true, rules: DEFAULT_TARGET_RULES });
});

describe("thresholds", () => {
  it("shows the documented defaults in plain numbers", () => {
    setup();

    expect(screen.getByLabelText("Amber above, percent over target")).toHaveValue(0);
    expect(screen.getByLabelText("Red at, percent over target")).toHaveValue(20);
    expect(
      screen.getByLabelText("Verdict tolerance, percent either side of target"),
    ).toHaveValue(10);
    expect(
      screen.getByLabelText("Sugar tolerance, percent either side of target"),
    ).toHaveValue(15);
    expect(
      screen.getByText(/Amber at 0% over, red at 20% over/),
    ).toBeInTheDocument();
  });

  it("keeps save disabled until something changes", async () => {
    const user = setup();
    const save = screen.getByRole("button", { name: "Save thresholds" });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("Amber above, percent over target"));
    await user.type(screen.getByLabelText("Amber above, percent over target"), "15");

    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("sends percentages as fractions", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Amber above, percent over target"));
    await user.type(screen.getByLabelText("Amber above, percent over target"), "15");
    await user.clear(screen.getByLabelText("Red at, percent over target"));
    await user.type(screen.getByLabelText("Red at, percent over target"), "35");
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() => expect(saveTargetRulesAction).toHaveBeenCalledTimes(1));
    expect(saveTargetRulesAction).toHaveBeenCalledWith(
      expect.objectContaining({ amberOver: 0.15, redAt: 0.35 }),
      "person-1",
    );
  });

  it("never lets red sit below amber", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Amber above, percent over target"));
    await user.type(screen.getByLabelText("Amber above, percent over target"), "30");
    await user.clear(screen.getByLabelText("Red at, percent over target"));
    await user.type(screen.getByLabelText("Red at, percent over target"), "10");
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() => expect(saveTargetRulesAction).toHaveBeenCalledTimes(1));
    const sent = saveTargetRulesAction.mock.calls[0][0] as TargetRules;
    expect(sent.redAt).toBe(0.3);
  });

  it("shows what the action stored when it clamps", async () => {
    const user = setup();
    saveTargetRulesAction.mockResolvedValueOnce({
      ok: true,
      rules: { ...DEFAULT_TARGET_RULES, amberOver: 0, redAt: 0.2 },
    });

    await user.clear(screen.getByLabelText("Red at, percent over target"));
    await user.type(screen.getByLabelText("Red at, percent over target"), "99");
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Red at, percent over target")).toHaveValue(20),
    );
  });

  it("resets to the documented defaults", async () => {
    const user = setup({ ...DEFAULT_TARGET_RULES, amberOver: 0.15, redAt: 0.4 });

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(resetTargetRulesAction).toHaveBeenCalledWith("person-1"));
    expect(screen.getByLabelText("Amber above, percent over target")).toHaveValue(0);
    expect(screen.getByLabelText("Red at, percent over target")).toHaveValue(20);
  });
});

describe("per-nutrient overrides", () => {
  it("reports how many targets are overridden", () => {
    setup({ ...DEFAULT_TARGET_RULES, overrides: { NA: 1800, SUGAR: 40 } });
    expect(screen.getByText("2 of 18 targets overridden")).toBeInTheDocument();
  });

  it("sends an override and marks the row", async () => {
    const user = setup();
    await user.click(screen.getByText("Adjust individual targets"));

    const protein = screen.getByLabelText("Protein daily target, g");
    await user.type(protein, "150");

    expect(screen.getByText("override")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() => expect(saveTargetRulesAction).toHaveBeenCalledTimes(1));
    expect(saveTargetRulesAction).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { PROCNT: 150 } }),
      "person-1",
    );
  });

  it("clearing a field returns that nutrient to the recommendation", async () => {
    const user = setup({ ...DEFAULT_TARGET_RULES, overrides: { NA: 1800 } });
    await user.click(screen.getByText("Adjust individual targets"));

    const sodium = screen.getByLabelText("Sodium daily target, mg");
    expect(sodium).toHaveValue(1800);

    await user.clear(sodium);
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() => expect(saveTargetRulesAction).toHaveBeenCalledTimes(1));
    expect(saveTargetRulesAction).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: {} }),
      "person-1",
    );
  });

  it("shows the profile recommendation as a placeholder", async () => {
    const user = setup();
    await user.click(screen.getByText("Adjust individual targets"));

    const sodium = recommended.find((target) => target.code === "NA")!;
    expect(screen.getByLabelText("Sodium daily target, mg")).toHaveAttribute(
      "placeholder",
      `${fmt(sodium.value, 0)} mg`,
    );
  });
});
