import { describe, expect, it } from "vitest";
import { effectFromRetention, getRetention, retentionFor } from "@/lib/process-retention";

describe("process-retention", () => {
  it("boiling loses vitamin C", () => {
    const r = getRetention("boil", "VITC");
    expect(r).not.toBeNull();
    expect(r!.factor).toBeLessThan(1);
  });

  it("unknown operation/nutrient returns null", () => {
    expect(getRetention("blanch", "VITC")).toBeNull();
  });

  it("effectFromRetention marks source reference when data exists", () => {
    const e = effectFromRetention("boil");
    expect(e.source).toBe("reference");
    expect(e.retention.VITC).toBeLessThan(1);
  });

  it("effectFromRetention marks source none when no data", () => {
    const e = effectFromRetention("marinate");
    expect(e.source).toBe("none");
  });

  it("retentionFor returns factors for all known nutrients", () => {
    const r = retentionFor("boil");
    expect(Object.keys(r).length).toBeGreaterThan(0);
  });
});
