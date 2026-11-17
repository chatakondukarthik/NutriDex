import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_THEME } from "@/lib/theme";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

function renderHeader() {
  return render(
    <ThemeProvider initial={DEFAULT_THEME}>
      <SiteHeader />
    </ThemeProvider>,
  );
}

/**
 * The header is the first thing every route renders, so it owns the skip
 * link. A keyboard user should reach the content in one keystroke instead
 * of tabbing through ten links and icon buttons.
 */
describe("site header", () => {
  it("offers a skip link that targets the content wrapper", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });

  it("puts the skip link before the wordmark in the tab order", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Skip to content" }),
    );
  });

  it("marks the current route", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Diary" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
