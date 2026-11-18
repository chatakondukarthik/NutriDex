import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NutrientPicker } from "@/components/nutrient-picker";
import type { NutrientCode } from "@/lib/nutrition/types";

const OPTIONS: NutrientCode[] = ["ENERC_KCAL", "PROCNT", "FAT", "NA", "VITC"];

function setup(value: ReadonlySet<NutrientCode> = new Set(OPTIONS), options = OPTIONS) {
  const onChange = vi.fn();
  render(<NutrientPicker options={options} value={value} onChange={onChange} />);
  return { onChange };
}

describe("NutrientPicker", () => {
  it("offers every group that has members in the options", () => {
    setup();
    for (const label of ["Energy", "Macros", "Minerals", "Vitamins"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    }
  });

  it("shows a live count of selected nutrients", () => {
    setup(new Set(["PROCNT"]));
    expect(screen.getByText("1 of 5 selected")).toBeInTheDocument();
  });

  it("toggles a single nutrient", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set(OPTIONS));
    await user.click(screen.getByRole("checkbox", { name: /sodium/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).not.toContain("NA");
    expect(onChange.mock.calls[0][0]).toContain("PROCNT");
  });

  it("toggling a group checkbox selects or clears exactly that group", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set(["ENERC_KCAL", "NA"]));
    // macro group: PROCNT + FAT both off → clicking adds both
    await user.click(screen.getByRole("checkbox", { name: /all macros/i }));
    const next = onChange.mock.calls[0][0] as Set<NutrientCode>;
    expect(next).toEqual(new Set(["ENERC_KCAL", "NA", "PROCNT", "FAT"]));
  });

  it("marks a partially selected group as indeterminate", () => {
    setup(new Set(["PROCNT"]));
    const macroBox = screen.getByRole("checkbox", { name: /all macros/i }) as HTMLInputElement;
    expect(macroBox.indeterminate).toBe(true);
    expect(macroBox.checked).toBe(false);
  });

  it("preset: Select all picks everything available", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set());
    await user.click(screen.getByRole("button", { name: /select all/i }));
    expect(onChange).toHaveBeenCalledWith(new Set(OPTIONS));
  });

  it("preset: Energy + macros picks exactly that slate", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set());
    await user.click(screen.getByRole("button", { name: /energy \+ macros/i }));
    expect(onChange).toHaveBeenCalledWith(new Set(["ENERC_KCAL", "PROCNT", "FAT"]));
  });

  it("preset: Clear picks nothing", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set(OPTIONS));
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it("a group with no selected members toggles into fully selected", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(new Set(["ENERC_KCAL"]));
    await user.click(screen.getByRole("checkbox", { name: /all vitamins/i }));
    const next = onChange.mock.calls[0][0] as Set<NutrientCode>;
    expect(next).toEqual(new Set(["ENERC_KCAL", "VITC"]));
  });

  it("renders an honest empty state when nothing is offered", () => {
    setup(new Set(), []);
    expect(screen.getByText(/every tracked nutrient here is already filled in/i)).toBeInTheDocument();
  });
});
