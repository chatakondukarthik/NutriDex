import { describe, expect, it } from "vitest";
import { prepareCapturedFood } from "@/lib/captured-food";

describe("prepareCapturedFood", () => {
  it("rejects an empty name", () => {
    const r = prepareCapturedFood({ name: "  " });
    expect(r.ok).toBe(false);
  });

  it("keeps omitted nutrients unknown", () => {
    const r = prepareCapturedFood({ name: "Test food" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.food.nutrients.every((n) => n.status === "unknown" && n.amount == null)).toBe(true);
    }
  });

  it("marks estimated nutrients as estimated", () => {
    const r = prepareCapturedFood({
      name: "Test food",
      nutrients: { ENERC_KCAL: 100, PROCNT: 5 },
      estimated: ["PROCNT"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const kcal = r.food.nutrients.find((n) => n.nutrient === "ENERC_KCAL")!;
      const prot = r.food.nutrients.find((n) => n.nutrient === "PROCNT")!;
      expect(kcal.status).toBe("known");
      expect(prot.status).toBe("estimated");
    }
  });

  it("rejects energy above 900 kcal/100g", () => {
    const r = prepareCapturedFood({ name: "X", nutrients: { ENERC_KCAL: 950 } });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-positive portion weight", () => {
    const r = prepareCapturedFood({ name: "X", portions: [{ label: "bowl", grams: 0 }] });
    expect(r.ok).toBe(false);
  });

  it("rejects too many portions", () => {
    const portions = Array.from({ length: 21 }, (_, i) => ({ label: `p${i}`, grams: 10 }));
    const r = prepareCapturedFood({ name: "X", portions });
    expect(r.ok).toBe(false);
  });

  it("dedupes aliases", () => {
    const r = prepareCapturedFood({ name: "X", aliases: ["a", "a", " b ", ""] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.food.aliases).toEqual(["a", "b"]);
  });
});
