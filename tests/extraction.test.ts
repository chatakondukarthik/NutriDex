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

  it("coerces string numbers, including label bounds and units", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrients":{"ENERC_KCAL":"387.44","PROCNT":"46.16","SUGAR":"<2","NA":"1.35 mg"}}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(p.nutrients?.PROCNT).toBe(46.16);
    expect(p.nutrients?.SUGAR).toBe(2);
    expect(p.nutrients?.NA).toBe(1.35);
  });

  it("maps human-readable panel keys onto the canonical codes", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrients":{"Energy (kcal)":"387.44","Protein (g)":"46.16","Carbohydrate (g)":"45.48","Total Sugars (g)":2,"Dietary Fibre (g)":"9","Total fat (g)":"2.32","Sodium (mg)":"4.04"}}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(p.nutrients?.PROCNT).toBe(46.16);
    expect(p.nutrients?.CHOCDF).toBe(45.48);
    expect(p.nutrients?.SUGAR).toBe(2);
    expect(p.nutrients?.FIBTG).toBe(9);
    expect(p.nutrients?.FAT).toBe(2.32);
    expect(p.nutrients?.NA).toBe(4.04);
  });

  it("matches keys regardless of case and punctuation", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrients":{"ENERGY_KCAL":387.44,"SODIUM_MG":"4.04","Total-Protein":"46.16"}}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(p.nutrients?.NA).toBe(4.04);
    expect(p.nutrients?.PROCNT).toBe(46.16);
  });

  it("coerces serving numbers written as strings", () => {
    const p = parseProposal('{"name":"Roti","servingSizeG":"33.3","servingsPerPack":"150"}');
    expect(p.servingSizeG).toBe(33.3);
    expect(p.servingsPerPack).toBe(150);
  });

  it("normalises the estimated list to canonical codes", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrients":{},"estimated":["energy","Fibre","ENERC_KCAL","Vitamin B12","not-a-nutrient"]}',
    );
    expect(p.estimated?.sort()).toEqual(
      ["ENERC_KCAL", "FIBTG", "VITB12"].sort(),
    );
  });

  it("omits the nutrients block rather than writing empties when nothing parses", () => {
    const p = parseProposal('{"name":"Flour","nutrients":{"blah":"x","elf":42}}');
    expect(p.nutrients).toBeUndefined();
  });

  it("recovers nutrients nested under near-miss keys", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrition":{"Energy (kcal)":"387.44","Protein (g)":"46.16","Fibre":9}}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(p.nutrients?.PROCNT).toBe(46.16);
    expect(p.nutrients?.FIBTG).toBe(9);
  });

  it("recovers nutrients answering under nutritionFacts", () => {
    const p = parseProposal(
      '{"name":"Flour","nutritionFacts":{"Sodium (mg)":"4.04","Total Sugars":"<2"}}',
    );
    expect(p.nutrients?.NA).toBe(4.04);
    expect(p.nutrients?.SUGAR).toBe(2);
  });

  it("recovers nutrients the model flattened onto the top level", () => {
    const p = parseProposal(
      '{"name":"Flour","Energy (kcal)":387.44,"Protein":"46.16","Total fat":"2.32"}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    expect(p.nutrients?.PROCNT).toBe(46.16);
    expect(p.nutrients?.FAT).toBe(2.32);
  });

  it("prefers the nutrients object over the flat fallback", () => {
    const p = parseProposal(
      '{"name":"Flour","nutrients":{"ENERC_KCAL":387.44},"Protein":1}',
    );
    expect(p.nutrients?.ENERC_KCAL).toBe(387.44);
    // The flat fallback is only a last resort: top-level Protein must not
    // leak in when the object answered.
    expect(p.nutrients?.PROCNT).toBeUndefined();
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
