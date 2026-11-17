import { describe, expect, it } from "vitest";
import {
  sanitizeGraph,
  sanitizeLayout,
  validateGraphShape,
  validateLayout,
} from "@/lib/nutrition/graph-validate";
import type { Graph } from "@/lib/nutrition/graph";

/**
 * `saveGraphAction` accepts whatever JSON a caller posts. Counts alone are
 * not enough: per-node outputs make the engine quadratic, and grams/factors
 * are multiplied straight into the stored nutrition. These cases pin the
 * per-node checks.
 */

function graph(overrides: Partial<Graph> = {}): Graph {
  return {
    nodes: [
      { id: "f1", type: "food", foodId: "paneer", grams: 100 },
      {
        id: "p1",
        type: "process",
        operation: "fry",
        name: "Fry",
        outputs: [{ label: "Fried", tag: "consumed", split: {} }],
      },
    ],
    edges: [{ id: "e1", from: "f1", to: "p1" }],
    ...overrides,
  };
}

function withProcess(patch: Record<string, unknown>): Graph {
  const base = graph();
  return {
    ...base,
    nodes: [base.nodes[0], { ...base.nodes[1], ...patch } as Graph["nodes"][number]],
  };
}

describe("validateGraphShape", () => {
  it("accepts a normal food → process graph", () => {
    expect(validateGraphShape(graph())).toBeNull();
  });

  it("rejects an empty or malformed graph", () => {
    expect(validateGraphShape(null)).toMatch(/not valid/);
    expect(validateGraphShape({ nodes: [], edges: [] })).toMatch(/at least one/i);
    expect(validateGraphShape({ nodes: "x", edges: [] })).toMatch(/not valid/);
  });

  it("rejects duplicate node ids", () => {
    const dup = graph({
      nodes: [
        { id: "f1", type: "food", foodId: "paneer", grams: 100 },
        { id: "f1", type: "food", foodId: "egg", grams: 50 },
      ],
      edges: [],
    });
    expect(validateGraphShape(dup)).toMatch(/duplicate node ids/i);
  });

  it.each([-500, 0, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])(
    "rejects a food weight of %s",
    (grams) => {
      const bad = graph({
        nodes: [{ id: "f1", type: "food", foodId: "paneer", grams }],
        edges: [],
      });
      expect(validateGraphShape(bad)).toMatch(/positive number|out of range/i);
    },
  );

  it("rejects more than eight outputs on one step", () => {
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      label: `out ${i}`,
      tag: "consumed" as const,
      split: {},
    }));
    expect(validateGraphShape(withProcess({ outputs }))).toMatch(/between 1 and 8/i);
  });

  it("rejects a split that names an unknown nutrient or exceeds 1", () => {
    expect(
      validateGraphShape(
        withProcess({ outputs: [{ label: "x", tag: "consumed", split: { NOT_A_CODE: 0.5 } }] }),
      ),
    ).toMatch(/unknown nutrient/i);
    expect(
      validateGraphShape(
        withProcess({ outputs: [{ label: "x", tag: "consumed", split: { FAT: 1.5 } }] }),
      ),
    ).toMatch(/out of range/i);
  });

  it("rejects an out-of-range or unknown factor override", () => {
    expect(validateGraphShape(withProcess({ factorOverrides: { FAT: 1e9 } }))).toMatch(
      /out-of-range factor/i,
    );
    expect(validateGraphShape(withProcess({ factorOverrides: { NOPE: 0.5 } }))).toMatch(
      /unknown nutrient/i,
    );
  });

  it("rejects measured outputs that do not line up with the outputs", () => {
    expect(validateGraphShape(withProcess({ measuredOutputs: [10, 20] }))).toMatch(
      /line up/i,
    );
  });

  it("rejects edges to unknown nodes, self-links and duplicates", () => {
    expect(
      validateGraphShape(graph({ edges: [{ id: "e", from: "f1", to: "ghost" }] })),
    ).toMatch(/unknown node/i);
    expect(
      validateGraphShape(graph({ edges: [{ id: "e", from: "p1", to: "p1" }] })),
    ).toMatch(/feed itself/i);
    expect(
      validateGraphShape(
        graph({
          edges: [
            { id: "e1", from: "f1", to: "p1" },
            { id: "e2", from: "f1", to: "p1" },
          ],
        }),
      ),
    ).toMatch(/duplicate connection/i);
  });
});

describe("validateLayout", () => {
  it("accepts finite positions and an absent layout", () => {
    expect(validateLayout(undefined)).toBeNull();
    expect(validateLayout({ f1: { x: 10, y: -20 } })).toBeNull();
  });

  it("rejects a non-finite position or a non-object value", () => {
    expect(validateLayout({ f1: { x: Number.NaN, y: 0 } })).toMatch(/invalid position/i);
    expect(validateLayout({ f1: { x: 0, y: Number.POSITIVE_INFINITY } })).toMatch(
      /invalid position/i,
    );
    expect(validateLayout({ f1: "nope" })).toMatch(/invalid position/i);
  });
});

describe("sanitizeGraph and sanitizeLayout", () => {
  it("drops extra keys from nodes, outputs, edges and layout positions", () => {
    const raw = {
      nodes: [
        {
          id: "f1",
          type: "food",
          foodId: "paneer",
          grams: 100,
          blob: "x".repeat(1_000_000),
        },
        {
          id: "p1",
          type: "process",
          operation: "fry",
          name: "Fry",
          outputs: [{ label: "Fried", tag: "consumed", split: {}, blob: "y" }],
          factorOverrides: { FAT: 0.9 },
          blob: "z",
        },
      ],
      edges: [{ id: "e1", from: "f1", to: "p1", blob: "w" }],
    };
    expect(validateGraphShape(raw)).toBeNull();

    const clean = sanitizeGraph(raw);
    expect(clean.nodes[0]).not.toHaveProperty("blob");
    expect(clean.nodes[1]).not.toHaveProperty("blob");
    const process = clean.nodes[1] as Extract<Graph["nodes"][number], { type: "process" }>;
    expect(process.outputs[0]).toEqual({ label: "Fried", tag: "consumed", split: {} });
    expect(process.factorOverrides).toEqual({ FAT: 0.9 });
    expect(clean.edges[0]).not.toHaveProperty("blob");
    // Serialising the sanitised graph is small regardless of the input.
    expect(JSON.stringify(clean).length).toBeLessThan(2_000);

    const layout = sanitizeLayout({ f1: { x: 1, y: 2, blob: "x".repeat(1_000_000) } });
    expect(layout).toEqual({ f1: { x: 1, y: 2 } });
    expect(JSON.stringify(layout).length).toBeLessThan(100);
  });

  it("keeps an absent layout absent", () => {
    expect(sanitizeLayout(undefined)).toBeUndefined();
  });
});
