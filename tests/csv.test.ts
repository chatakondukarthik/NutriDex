import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/importer/csv";

/**
 * The importer used to split on newlines before parsing, so a quoted field
 * containing a line break became two broken rows, and there was no row cap.
 * These cases pin the RFC 4180 behaviour the food tables rely on.
 */

describe("parseCsv", () => {
  it("splits ordinary rows and trims fields", () => {
    const { headers, rows } = parseCsv("name, kcal\n Paneer , 265\nDal,116\n");
    expect(headers).toEqual(["name", "kcal"]);
    expect(rows).toEqual([
      { name: "Paneer", kcal: "265" },
      { name: "Dal", kcal: "116" },
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    const { rows } = parseCsv('name,note\n"Rice, cooked",fluffy\n');
    expect(rows[0].name).toBe("Rice, cooked");
    expect(rows[0].note).toBe("fluffy");
  });

  it("unescapes doubled quotes", () => {
    const { rows } = parseCsv('name,note\n"Dal ""tadka""",spicy\n');
    expect(rows[0].name).toBe('Dal "tadka"');
  });

  it("keeps a newline inside a quoted field in one row", () => {
    const { rows } = parseCsv('name,note\n"Dal\nwith rice",lunch\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Dal\nwith rice");
  });

  it("handles CRLF and a bare CR as record separators", () => {
    const { rows } = parseCsv("name,kcal\r\nPaneer,265\rDal,116");
    expect(rows).toEqual([
      { name: "Paneer", kcal: "265" },
      { name: "Dal", kcal: "116" },
    ]);
  });

  it("does not add a phantom row for a trailing newline", () => {
    const { rows } = parseCsv("name\nPaneer\n\n");
    expect(rows).toHaveLength(1);
  });

  it("uses null-prototype rows so a hostile header cannot pollute a prototype", () => {
    const { rows } = parseCsv("__proto__,constructor\npolluted,also\n");
    expect(Object.getPrototypeOf(rows[0])).toBeNull();
    expect(rows[0].__proto__).toBe("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("aborts during the scan once the row cap is exceeded", () => {
    const header = "name\n";
    const body = "x\n".repeat(50_001);
    expect(() => parseCsv(header + body)).toThrow(/more than 50000 rows/);
  });

  it("allows exactly the cap", () => {
    const header = "name\n";
    const body = "x\n".repeat(50_000);
    expect(parseCsv(header + body).rows).toHaveLength(50_000);
  });

  it("rejects an unterminated quoted field instead of swallowing the rest", () => {
    expect(() => parseCsv('name,note\nDal,"never closed\nmore text')).toThrow(
      /unterminated quoted field/,
    );
  });
});
