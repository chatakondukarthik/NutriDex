import { describe, expect, it } from "vitest";
import {
  parseRecipeFragment,
  serializeFragment,
  FRAGMENT_APP,
} from "@/lib/recipe-fragment";

const foodNode = {
  id: "f1",
  type: "food",
  position: { x: 10, y: 20 },
  data: { foodId: "paneer", grams: 200, label: "Paneer", unknownCount: 3 },
};

const processNode = {
  id: "p1",
  type: "process",
  position: { x: 340, y: 40 },
  data: {
    name: "Fry onions",
    operation: "fry",
    qualifier: null,
    outputs: [
      { label: "Paneer bhurji", tag: "consumed", split: { PROCNT: 1 } },
      { label: "Achaar (discarded)", tag: "discarded", split: { FAT: 0.4 } },
    ],
    measuredOutputs: [300, null],
    factorEstimates: { IRON: 0.85 },
    factorOverrides: {},
    // foreign keys that must not survive serialisation
    selected: true,
    dragHandles: [1, 2, 3],
  },
};

const edges = [{ id: "e1", source: "f1", target: "p1" }];

describe("serializeFragment", () => {
  it("round-trips a selection and strips foreign data", () => {
    const json = serializeFragment([foodNode, processNode], edges, new Set(["f1", "p1"]));
    expect(json).toBeTruthy();
    const parsed = parseRecipeFragment(json!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.fragment.nodes).toHaveLength(2);
    expect(parsed.fragment.edges).toHaveLength(1);
    expect(parsed.fragment.edges[0]).toMatchObject({ from: "f1", to: "p1" });

    const process = parsed.fragment.nodes.find((n) => n.id === "p1")!;
    expect(process.data).not.toHaveProperty("selected");
    expect(process.data).not.toHaveProperty("dragHandles");
    expect(process.data).not.toHaveProperty("unknownCount");
    expect(process.data).toMatchObject({ name: "Fry onions", operation: "fry" });
  });

  it("excludes edges whose far end is outside the selection", () => {
    const outside = { id: "f2", type: "food", position: { x: 0, y: 0 }, data: { foodId: "milk", grams: 100 } };
    const json = serializeFragment(
      [foodNode, outside],
      [
        { id: "e1", source: "f1", target: "p1" },
        { id: "e2", source: "f2", target: "p1" },
      ],
      new Set(["f1"]),
    );
    const parsed = parseRecipeFragment(json!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fragment.edges).toHaveLength(0);
  });

  it("returns null when the selection is empty", () => {
    expect(serializeFragment([foodNode], edges, new Set())).toBeNull();
  });

  it("carries notes on both block types and trims them", () => {
    const withNotes = [
      { ...foodNode, data: { ...foodNode.data, note: "  pat dry  " } },
      { ...processNode, data: { ...processNode.data, note: "Whip to a ribbon" } },
    ];
    const json = serializeFragment(withNotes, [], undefined);
    expect(json).toBeTruthy();
    const parsed = parseRecipeFragment(json!);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fragment.nodes[0].data.note).toBe("pat dry");
    expect(parsed.fragment.nodes[1].data.note).toBe("Whip to a ribbon");
  });
});

describe("parseRecipeFragment", () => {
  it("rejects garbage", () => {
    expect(parseRecipeFragment("not json {").ok).toBe(false);
    expect(parseRecipeFragment('"hello"').ok).toBe(false);
    expect(parseRecipeFragment("42").ok).toBe(false);
  });

  it("rejects a foreign envelope", () => {
    const result = parseRecipeFragment(JSON.stringify({ app: "something-else", nodes: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a NutriPlan/i);
  });

  it("rejects an unsupported version", () => {
    const result = parseRecipeFragment(
      JSON.stringify({ app: FRAGMENT_APP, version: 99, nodes: [foodNode] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it("rejects an empty block list", () => {
    const result = parseRecipeFragment(
      JSON.stringify({ app: FRAGMENT_APP, version: 2, nodes: [] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a food block without a food id, with a specific message", () => {
    const broken = { ...foodNode, data: { grams: 100 } };
    const result = parseRecipeFragment(
      JSON.stringify({ app: FRAGMENT_APP, version: 2, nodes: [broken], edges: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/food id/i);
  });

  it("rejects duplicate ids", () => {
    const result = parseRecipeFragment(
      JSON.stringify({ app: FRAGMENT_APP, version: 2, nodes: [foodNode, foodNode] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/twice/);
  });

  it("rejects connections that reference missing blocks", () => {
    const result = parseRecipeFragment(
      JSON.stringify({
        app: FRAGMENT_APP,
        version: 2,
        nodes: [foodNode],
        edges: [{ from: "f1", to: "ghost" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ghost/i);
  });

  it("drops self-loops and duplicate connections instead of failing", () => {
    const result = parseRecipeFragment(
      JSON.stringify({
        app: FRAGMENT_APP,
        version: 2,
        nodes: [foodNode, processNode],
        edges: [
          { from: "f1", to: "f1" },
          { from: "f1", to: "p1" },
          { from: "f1", to: "p1" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.edges).toHaveLength(1);
  });

  it("accepts a v1-shaped envelope (from/source, to/target)", () => {
    const result = parseRecipeFragment(
      JSON.stringify({
        app: FRAGMENT_APP,
        version: 1,
        nodes: [foodNode, processNode],
        edges: [{ id: "e1", source: "f1", target: "p1" }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("defaults a missing process name and coerces unknown split values out", () => {
    const odd = {
      ...processNode,
      data: {
        operation: "fry",
        outputs: [{ label: "x", tag: "mystery", split: { PROCNT: "2.5", IRON: -1, FAT: "lots" } }],
      },
    };
    const result = parseRecipeFragment(
      JSON.stringify({ app: FRAGMENT_APP, version: 2, nodes: [odd], edges: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const process = result.fragment.nodes[0];
    expect(process.data.name).toBe("Step");
    const outputs = process.data.outputs as Array<{ tag: string; split: Record<string, number> }>;
    expect(outputs[0].tag).toBe("consumed");
    expect(outputs[0].split).toEqual({ PROCNT: 2.5 });
  });

  it("trims and caps an oversized note instead of rejecting the fragment", () => {
    const long = "x".repeat(1200);
    const result = parseRecipeFragment(
      JSON.stringify({
        app: FRAGMENT_APP,
        version: 2,
        nodes: [{ ...foodNode, data: { ...foodNode.data, note: `  ${long}  ` } }],
        edges: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.fragment.nodes[0].data.note as string).length).toBe(1000);
  });

  it("turns a whitespace-only note into null", () => {
    const result = parseRecipeFragment(
      JSON.stringify({
        app: FRAGMENT_APP,
        version: 2,
        nodes: [{ ...foodNode, data: { ...foodNode.data, note: "   " } }],
        edges: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.nodes[0].data.note).toBeNull();
  });
});
