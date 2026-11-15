import { describe, expect, it } from "vitest";
import { prepareVersion, type RecipeDraft } from "@/lib/recipe-validate";

/**
 * Server-side draft validation.
 *
 * The builder is a convenience, not a gate. These tests treat `RecipeDraft`
 * as untrusted input, because that is what it is once it crosses the server
 * action boundary.
 */

function draft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    name: "Paneer bhurji",
    instructions: "Cook it.",
    servings: 2,
    blocks: [
      {
        name: "Cook",
        operation: "fry",
        inputs: [{ foodId: "paneer", amount: 200, unit: "g" }],
      },
    ],
    ...overrides,
  };
}

describe("prepareVersion: identity", () => {
  it("trims the name and rejects a blank one", () => {
    const ok = prepareVersion(draft({ name: "  Paneer bhurji  " }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.version).toBeDefined();

    expect(prepareVersion(draft({ name: "   " }))).toEqual({
      ok: false,
      message: "Give the recipe a name.",
    });
  });

  it("stores a trimmed version label, or null", () => {
    const labelled = prepareVersion(draft({ versionLabel: "  less salt " }));
    expect(labelled.ok).toBe(true);
    if (labelled.ok) expect(labelled.version.label).toBe("less salt");

    const blank = prepareVersion(draft({ versionLabel: "   " }));
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.version.label).toBeNull();
  });
});

describe("prepareVersion: servings", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s servings", (servings) => {
    const result = prepareVersion(draft({ servings }));
    expect(result.ok).toBe(false);
  });

  it("rejects an implausible serving count", () => {
    expect(prepareVersion(draft({ servings: 101 }))).toEqual({
      ok: false,
      message: "That is a lot of servings. Check the number.",
    });
  });
});

describe("prepareVersion: ingredients", () => {
  it("rejects a draft with no ingredients", () => {
    expect(prepareVersion(draft({ blocks: [] }))).toEqual({
      ok: false,
      message: "Add at least one ingredient.",
    });
  });

  it("rejects a draft whose blocks are all empty", () => {
    expect(prepareVersion(draft({ blocks: [{ name: "Prep", inputs: [] }] }))).toEqual({
      ok: false,
      message: "Add at least one ingredient.",
    });
  });

  it("rejects an unknown food id", () => {
    const result = prepareVersion(
      draft({ blocks: [{ inputs: [{ foodId: "not-a-food", amount: 1, unit: "g" }] }] }),
    );
    expect(result).toEqual({
      ok: false,
      message: "One of the ingredients is no longer available.",
    });
  });

  it("rejects an unsupported unit", () => {
    const result = prepareVersion(
      draft({ blocks: [{ inputs: [{ foodId: "paneer", amount: 1, unit: "cups" }] }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unsupported unit/i);
  });

  it.each([0, -5, Number.NaN])("rejects an amount of %s", (amount) => {
    const result = prepareVersion(
      draft({ blocks: [{ inputs: [{ foodId: "paneer", amount, unit: "g" }] }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("keeps a named portion as part of the stored unit", () => {
    const result = prepareVersion(
      draft({
        blocks: [
          {
            inputs: [
              { foodId: "paneer", amount: 1, unit: "portion", portionLabel: "1 katori" },
            ],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.blocks[0].inputs[0].unit).toBe("portion:1 katori");
    }
  });

  it("names unnamed blocks by position", () => {
    const result = prepareVersion(
      draft({
        blocks: [
          { inputs: [{ foodId: "paneer", amount: 50, unit: "g" }] },
          { inputs: [{ foodId: "onion", amount: 50, unit: "g" }] },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.blocks.map((block) => block.name)).toEqual(["Step 1", "Step 2"]);
    }
  });

  it("ignores a non-positive output weight instead of treating it as measured", () => {
    for (const outputGrams of [0, -10, Number.NaN]) {
      const result = prepareVersion(
        draft({
          blocks: [
            {
              outputGrams,
              inputs: [{ foodId: "paneer", amount: 100, unit: "g" }],
            },
          ],
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.version.yieldGrams).toBeNull();
        expect(result.version.blocks[0].outputGrams).toBeNull();
      }
    }
  });

  it("computes the snapshot on the server from gram weights", () => {
    const result = prepareVersion(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.version.snapshot.perServing.totals.ENERC_KCAL).toBeGreaterThan(0);
    expect(result.version.snapshot.servings).toBe(2);
  });

  it("does not let a huge amount overflow into a non-finite weight", () => {
    const result = prepareVersion(
      draft({ blocks: [{ inputs: [{ foodId: "paneer", amount: 1e308, unit: "kg" }] }] }),
    );
    expect(result.ok).toBe(false);
  });
});
