import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_THEME } from "@/lib/theme";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const switchPersonAction = vi.fn();

vi.mock("@/app/actions", () => ({
  switchPersonAction: (personId: unknown) => switchPersonAction(personId),
}));

const PEOPLE = [
  { id: "person-1", displayName: "Karthik" },
  { id: "person-2", displayName: "Priya" },
];

function renderHeader() {
  return render(
    <ThemeProvider initial={DEFAULT_THEME}>
      <SiteHeader people={PEOPLE} activePersonId="person-1" />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  switchPersonAction.mockReset();
  switchPersonAction.mockResolvedValue({ ok: true, personId: "person-2" });
});

/**
 * The header is the first thing every route renders, so it owns the skip
 * link. A keyboard user should reach the content in one keystroke instead
 * of tabbing through ten links and icon buttons. It also owns the active
 * person switcher, which must look like a household picker, not a login.
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

describe("person switcher", () => {
  it("shows the active person and marks them in the menu", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: /Active person: Karthik/ }),
    );

    const menu = screen.getByRole("menu", { name: "Switch person" });
    expect(menu).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: /Karthik/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: /Priya/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("switches person without treating it as a login", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: /Active person: Karthik/ }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: /Priya/ }));

    await waitFor(() => expect(switchPersonAction).toHaveBeenCalledWith("person-2"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = screen.getByRole("button", { name: /Active person: Karthik/ });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("links to the People settings", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: /Active person: Karthik/ }),
    );
    expect(screen.getByRole("menuitem", { name: /Manage people/ })).toHaveAttribute(
      "href",
      "/settings#people",
    );
  });
});
