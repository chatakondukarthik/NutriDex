import { describe, expect, it } from "vitest";
import {
  computeGraph,
  type FactorTable,
  type Graph,
  type GraphProcessNode,
} from "@/lib/nutrition/graph";
import { makeProfile } from "@/lib/nutrition/engine";
import type { NutrientProfile } from "@/lib/nutrition/types";

const paneerProfile = makeProfile(
  { ENERC_KCAL: 265, PROCNT: 18, FAT: 20, CA: 208 },
  "test",
) as NutrientProfile;
const tomatoProfile = makeProfile(
  { ENERC_KCAL: 18, CHOCDF: 3.9, VITC: 13 },
  "test",
) as NutrientProfile;
const cashewProfile = makeProfile(
  { ENERC_KCAL: 553, FAT: 44, PROCNT: 18.2 },
  "test",
) as NutrientProfile;
const riceProfile = makeProfile(
  { ENERC_KCAL: 130, CHOCDF: 28, PROCNT: 2.7 },
  "test",
) as NutrientProfile;

const resolve = (id: string): NutrientProfile => {
  switch (id) {
    case "paneer": return paneerProfile;
    case "tomato": return tomatoProfile;
    case "cashew": return cashewProfile;
    case "rice": return riceProfile;
    default: throw new Error(`unknown food ${id}`);
  }
};

const four = (n: number): number => n;
void four;

describe("computeGraph", () => {
  it("a single food resolves to its full rollup", () => {
    const graph: Graph = {
      nodes: [{ id: "a", type: "food", foodId: "paneer", grams: 100 }],
      edges: [],
    };
    const result = computeGraph(graph, resolve);
    expect(result.consumed.totals.ENERC_KCAL).toBe(265);
    expect(result.consumedGrams).toBe(100);
  });

  it("a boil block drops nutrients per the table factors", () => {
    const table: FactorTable = {
      lookup: new Map([
        ["boil", new Map([
          ["drained", new Map([
            ["VITC", { factor: 0.5, source: "usda-r6" }],
          ] as const)],
        ])],
      ]),
    };
    const graph: Graph = {
      nodes: [
        { id: "food", type: "food", foodId: "tomato", grams: 100 },
        {
          id: "boil",
          type: "process",
          operation: "boil",
          qualifier: "drained",
          name: "Boil tomatoes",
          outputs: [{ label: "Boiled tomatoes", tag: "consumed", split: {} }],
        },
      ],
      edges: [{ id: "e1", from: "food", to: "boil" }],
    };
    const result = computeGraph(graph, resolve, { factorTable: table });
    expect(result.consumed.totals.VITC).toBe(6.5);
    const node = result.perNode.get("boil")!;
    expect(node.factors).toEqual([{ nutrient: "VITC", factor: 0.5, source: "table" }]);
    expect(node.unknownNutrients).toContain("PROCNT");
  });

  it("a node override beats the table", () => {
    const table: FactorTable = {
      lookup: new Map([
        ["boil", new Map([["drained", new Map([["VITC", { factor: 0.5, source: "usda-r6" }]])]])],
      ]),
    };
    const node: GraphProcessNode = {
      id: "boil", type: "process", operation: "boil", qualifier: "drained",
      name: "Boil", factorOverrides: { VITC: 0.1 },
      outputs: [{ label: "out", tag: "consumed", split: {} }],
    };
    const graph: Graph = {
      nodes: [{ id: "f", type: "food", foodId: "tomato", grams: 100 }, node],
      edges: [{ id: "e", from: "f", to: "boil" }],
    };
    const result = computeGraph(graph, resolve, { factorTable: table });
    expect(result.perNode.get("boil")!.factors[0].source).toBe("override");
    expect(result.consumed.totals.VITC).toBe(1.3);
  });

  it("an LLM estimate fills gaps the table does not cover", () => {
    const node: GraphProcessNode = {
      id: "fry", type: "process", operation: "fry", name: "Fry paneer",
      factorEstimates: { PROCNT: 0.95, VITB12: 0.8 },
      outputs: [{ label: "Fried paneer", tag: "consumed", split: {} }],
    };
    const graph: Graph = {
      nodes: [{ id: "f", type: "food", foodId: "paneer", grams: 50 }, node],
      edges: [{ id: "e", from: "f", to: "fry" }],
    };
    const result = computeGraph(graph, resolve);
    expect(result.consumed.totals.PROCNT).toBeCloseTo(8.55, 5);
    const factor = result.perNode.get("fry")!.factors.find((f) => f.nutrient === "PROCNT")!;
    expect(factor.source).toBe("estimated");
  });

  it("multi-output (hung curd) partitions nutrients across outputs", () => {
    const curd = makeProfile(
      { ENERC_KCAL: 98, PROCNT: 3.5, FAT: 4.75, CHOCDF: 4.7, NA: 36, VITB12: 0.4 },
      "test",
    ) as NutrientProfile;
    const resolve2 = () => curd;
    const graph: Graph = {
      nodes: [
        { id: "curd", type: "food", foodId: "curd", grams: 100 },
        {
          id: "hang",
          type: "process",
          operation: "strain",
          name: "Hang curd",
          measuredOutputs: [70, 30],
          outputs: [
            { label: "Hung curd", tag: "consumed", split: { FAT: 0.98, PROCNT: 0.8, CHOCDF: 0.35, NA: 0.55, VITB12: 0.6, ENERC_KCAL: 0.6 } },
            { label: "Whey", tag: "discarded", split: { FAT: 0.02, PROCNT: 0.2, CHOCDF: 0.65, NA: 0.45, VITB12: 0.4, ENERC_KCAL: 0.4 } },
          ],
        },
      ],
      edges: [{ id: "e", from: "curd", to: "hang" }],
    };
    const result = computeGraph(graph, resolve2);
    // curd keeps almost all the fat
    const hung = result.perNode.get("hang")!.after[0];
    expect(hung.totals.FAT).toBeCloseTo(4.655, 6);
    // whey keeps most of the lactose
    const whey = result.perNode.get("hang")!.after[1];
    expect(whey.totals.CHOCDF).toBeCloseTo(3.055, 5);
    // consumed output is the hung curd; grams recorded
    expect(result.consumedGrams).toBe(70);
    expect(result.discardedGrams).toBe(30);
    // discarded whey is tracked separately
    expect(result.discarded.totals.CHOCDF).toBeCloseTo(3.055, 5);
  });

  it("detects cycles in the graph", () => {
    const graph: Graph = {
      nodes: [
        { id: "a", type: "process", operation: "mix", name: "A", outputs: [{ label: "a", tag: "consumed", split: {} }] },
        { id: "b", type: "process", operation: "mix", name: "B", outputs: [{ label: "b", tag: "consumed", split: {} }] },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "ba", from: "b", to: "a" },
      ],
    };
    expect(() => computeGraph(graph, resolve)).toThrow(/cycle/);
  });

  it("two inputs merging into one process node works", () => {
    const graph: Graph = {
      nodes: [
        { id: "tomato", type: "food", foodId: "tomato", grams: 100 },
        { id: "cashew", type: "food", foodId: "cashew", grams: 50 },
        { id: "cook", type: "process", operation: "sauté", name: "Cook", outputs: [{ label: "Cooked", tag: "consumed", split: {} }] },
      ],
      edges: [
        { id: "e1", from: "tomato", to: "cook" },
        { id: "e2", from: "cashew", to: "cook" },
      ],
    };
    const result = computeGraph(graph, resolve);
    // 18*1 + 553*0.5 = 294.5 kcal
    expect(result.consumed.totals.ENERC_KCAL).toBeCloseTo(294.5, 5);
  });

  it("intermediate consumed output is preferred when a node has both", () => {
    // A food node followed by a process with 2 outputs: the consumed one flows onward
    const graph: Graph = {
      nodes: [
        { id: "curd", type: "food", foodId: "rice", grams: 100 },
        {
          id: "split",
          type: "process",
          operation: "strain",
          name: "Split",
          outputs: [
            { label: "out1", tag: "consumed", split: { ENERC_KCAL: 0.3, PROCNT: 0.2, CHOCDF: 0.1 } },
            { label: "out2", tag: "discarded", split: { ENERC_KCAL: 0.7, PROCNT: 0.8, CHOCDF: 0.9 } },
          ],
        },
        {
          id: "next",
          type: "process",
          operation: "mix",
          name: "Next",
          outputs: [{ label: "final", tag: "consumed", split: {} }],
        },
      ],
      edges: [
        { id: "e1", from: "curd", to: "split" },
        { id: "e2", from: "split", to: "next" },
      ],
    };
    const result = computeGraph(graph, resolve);
    // rice = 130 kcal; split out (consumed) = 40% -> next node = 39 kcal
    expect(result.consumed.totals.ENERC_KCAL).toBeCloseTo(39, 5);
  });
});
