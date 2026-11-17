import { describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/graph-layout";

/**
 * The same helper the flow editor's Auto-layout button and the AI
 * materializer both call, so a saved recipe always opens arranged.
 */
describe("layoutGraph", () => {
  it("returns no positions for an empty graph", () => {
    expect(layoutGraph([], [])).toEqual({});
  });

  it("arranges a source left of its target", () => {
    const pos = layoutGraph(
      [
        { id: "f", type: "food" },
        { id: "p", type: "process" },
      ],
      [{ from: "f", to: "p" }],
    );
    expect(pos.f).toBeTruthy();
    expect(pos.p).toBeTruthy();
    expect(pos.p.x).toBeGreaterThan(pos.f.x);
  });

  it("keeps a chain ordered left to right", () => {
    const pos = layoutGraph(
      [
        { id: "f", type: "food" },
        { id: "p1", type: "process" },
        { id: "p2", type: "process" },
      ],
      [
        { from: "f", to: "p1" },
        { from: "p1", to: "p2" },
      ],
    );
    expect(pos.f.x).toBeLessThan(pos.p1.x);
    expect(pos.p1.x).toBeLessThan(pos.p2.x);
  });

  it("keeps every node inside a positive frame", () => {
    const pos = layoutGraph([{ id: "only", type: "food" }], []);
    expect(pos.only.x).toBeGreaterThanOrEqual(40);
    expect(pos.only.y).toBeGreaterThanOrEqual(40);
  });

  it("ignores stale edges instead of throwing", () => {
    const pos = layoutGraph([{ id: "f", type: "food" }], [{ from: "f", to: "ghost" }]);
    expect(Object.keys(pos)).toEqual(["f"]);
  });

  it("is deterministic for the same input", () => {
    const nodes = [
      { id: "f1", type: "food" },
      { id: "p1", type: "process", note: "ribbon" },
      { id: "p2", type: "process" },
    ];
    const edges = [
      { from: "f1", to: "p1" },
      { from: "p1", to: "p2" },
    ];
    expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges));
  });
});
