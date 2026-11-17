import { describe, expect, it } from "vitest";
import { cleanNote, MAX_NOTE_LENGTH } from "@/lib/notes";

/**
 * Notes are optional, bounded and text-only. Every writer (editor, AI,
 * fragments, saves) funnels through cleanNote so one long paste cannot
 * bloat a snapshot.
 */
describe("cleanNote", () => {
  it("caps at 1000 characters", () => {
    expect(MAX_NOTE_LENGTH).toBe(1000);
    expect(cleanNote("x".repeat(1500))).toHaveLength(1000);
    expect(cleanNote("x".repeat(1000))).toHaveLength(1000);
  });

  it("trims and drops anything empty or non-textual", () => {
    expect(cleanNote("  whip to a ribbon  ")).toBe("whip to a ribbon");
    expect(cleanNote("")).toBeUndefined();
    expect(cleanNote("   \n  ")).toBeUndefined();
    expect(cleanNote(undefined)).toBeUndefined();
    expect(cleanNote(null)).toBeUndefined();
    expect(cleanNote(42)).toBeUndefined();
    expect(cleanNote({ text: "hi" })).toBeUndefined();
  });

  it("keeps inner newlines", () => {
    expect(cleanNote("line one\nline two")).toBe("line one\nline two");
  });
});
