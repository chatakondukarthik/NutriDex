import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseThemeSettings } from "@/lib/theme";

describe("parseThemeSettings — Chef's transition", () => {
  it("defaults the fold to on with no cookies present", () => {
    expect(parseThemeSettings({}).transition).toBe(true);
    expect(DEFAULT_THEME.transition).toBe(true);
  });

  it("round-trips an explicit off", () => {
    expect(parseThemeSettings({ transition: "off" }).transition).toBe(false);
    expect(parseThemeSettings({ transition: "on" }).transition).toBe(true);
  });

  it("leaves an unreadable value at the default rather than off", () => {
    expect(parseThemeSettings({ transition: "banana" }).transition).toBe(true);
  });
});
