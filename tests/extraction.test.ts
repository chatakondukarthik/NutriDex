import { describe, expect, it } from "vitest";
import { parseProposal, proposalToInput } from "@/lib/ai/extract";

describe("parseProposal", () => {
  it("parses a clean JSON object", () => {
    const p = parseProposal('{"name":"Paneer","nutrients":{"ENERC_KCAL":265}}');
    expect(p.name).toBe("Paneer");
    expect(p.nutrients?.ENERC_KCAL).toBe(265);
  });

  it("strips markdown code fences", () => {
    const p = parseProposal('```json\n{"name":"Milk"}\n```');
    expect(p.name).toBe("Milk");
  });

  it("repairs truncated JSON", () => {
    const p = parseProposal('{"name":"Paneer","aliases":["a"');
    expect(p.name).toBe("Paneer");
  });

  it("throws when there is no JSON", () => {
    expect(() => parseProposal("sorry, no data")).toThrow();
  });

  it("ignores unknown nutrient codes", () => {
    const p = parseProposal('{"name":"X","nutrients":{"ENERC_KCAL":100,"FOO":5}}');
    expect(p.nutrients?.ENERC_KCAL).toBe(100);
    expect((p.nutrients as any)?.FOO).toBeUndefined();
  });
});

describe("proposalToInput", () => {
  it("defaults kind to branded and state to raw", () => {
    const input = proposalToInput({ name: "Test" });
    expect(input.kind).toBe("branded");
    expect(input.state).toBe("raw");
    expect(input.source).toBe("llm");
  });

  it("carries nutrients through", () => {
    const input = proposalToInput({ name: "Test", nutrients: { ENERC_KCAL: 100 } });
    expect(input.nutrients?.ENERC_KCAL).toBe(100);
  });
});
