import { describe, expect, it } from "vitest";
import {
  applyEffect,
  computeChange,
  legacyBlocksToGraph,
  noOpEffect,
  topoSort,
  validateGraph,
} from "@/lib/recipe-graph";
import { makeProfile } from "@/lib/nutrition/engine";

describe("recipe-graph", () => {
  it("applyEffect scales by retention", () => {
    const before = makeProfile({ ENERC_KCAL: 100, VITC: 10 }, "test");
    const effect = { operation: "boil" as const, retention: { ENERC_KCAL: 1, VITC: 0.5 }, added: {}, removed: {}, source: "estimated" as const, rationale: "", confidence: 0.5 };
    const after = applyEffect(before, effect, 100);
    expect(after.ENERC_KCAL.amount).toBe(100);
    expect(after.VITC.amount).toBe(5);
  });

  it("applyEffect adds nutrients per 100g of output", () => {
    const before = makeProfile({ ENERC_KCAL: 100 }, "test");
    const effect = { operation: "fry" as const, retention: { ENERC_KCAL: 1 }, added: { FAT: 5 }, removed: {}, source: "estimated" as const, rationale: "", confidence: 0.5 };
    const after = applyEffect(before, effect, 200);
    // 5 * (200/100) = 10 added
    expect(after.FAT.amount).toBe(10);
  });

  it("computeChange returns deltas and percents", () => {
    const before = makeProfile({ ENERC_KCAL: 100 }, "test");
    const after = makeProfile({ ENERC_KCAL: 80 }, "test");
    const changes = computeChange(before, after);
    const e = changes.find((c) => c.code === "ENERC_KCAL")!;
    expect(e.delta).toBe(-20);
    expect(e.percent).toBe(-20);
  });

  it("noOpEffect leaves everything unchanged", () => {
    const before = makeProfile({ ENERC_KCAL: 100, PROCNT: 10 }, "test");
    const after = applyEffect(before, noOpEffect(), 100);
    expect(after.ENERC_KCAL.amount).toBe(100);
    expect(after.PROCNT.amount).toBe(10);
  });

  it("legacyBlocksToGraph produces a straight line", () => {
    const graph = legacyBlocksToGraph([
      { name: "A", inputs: [{ foodId: "paneer", grams: 100, amount: 100, unit: "g" }], outputGrams: 90 },
      { name: "B", inputs: [], outputGrams: 80 },
    ]);
    expect(graph.nodes.length).toBe(2);
    expect(graph.nodes[0].id).toBe("b1");
    expect(graph.nodes[1].dependsOn).toContain("b1");
    expect(topoSort(graph)).toEqual(["b1", "b2"]);
  });

  it("validateGraph rejects unknown foods", () => {
    const graph = legacyBlocksToGraph([
      { name: "A", inputs: [{ foodId: "nope", grams: 100, amount: 100, unit: "g" }], outputGrams: 90 },
    ]);
    const r = validateGraph(graph, new Set(["paneer"]));
    expect(r.ok).toBe(false);
  });

  it("validateGraph rejects cycles", () => {
    const graph = {
      nodes: [
        { id: "a", label: "A", kind: "process" as const, inputs: [{ source: { type: "node" as const, nodeId: "b", outputIndex: 0 }, grams: 10, amount: 10, unit: "g" }], operation: "none" as const, outputMassG: 10, yieldBasis: "none" as const, outputs: [{ name: "A", grams: 10 }], lane: 0, dependsOn: ["b"] },
        { id: "b", label: "B", kind: "process" as const, inputs: [{ source: { type: "node" as const, nodeId: "a", outputIndex: 0 }, grams: 10, amount: 10, unit: "g" }], operation: "none" as const, outputMassG: 10, yieldBasis: "none" as const, outputs: [{ name: "B", grams: 10 }], lane: 0, dependsOn: ["a"] },
      ],
      edges: [{ from: "a", to: "b", outputIndex: 0 }, { from: "b", to: "a", outputIndex: 0 }],
    };
    const r = validateGraph(graph, new Set());
    expect(r.ok).toBe(false);
  });
});
