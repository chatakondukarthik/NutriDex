import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RouteMotif from "@/components/route-motif";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_THEME } from "@/lib/theme";

let mockPath = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

function renderMotif(settings = DEFAULT_THEME) {
  return render(
    <ThemeProvider initial={settings}>
      <RouteMotif />
    </ThemeProvider>,
  );
}

describe("RouteMotif", () => {
  const cases: Array<[string, string]> = [
    ["/", "diary-rim"],
    ["/plan", "plan-rim"],
    ["/recipes", "recipes-rim"],
    ["/foods", "foods-rattan"],
    ["/profile", "profile-rim"],
    ["/about", "about-rim"],
    ["/glossary", "glossary-rim"],
  ];

  for (const [path, gradientId] of cases) {
    it(`renders the ${path} plate in the SVG namespace`, () => {
      mockPath = path;
      const { container } = renderMotif();
      const frame = container.querySelector(".motif-frame");
      expect(frame?.getAttribute("aria-hidden")).toBe("true");
      const svg = frame?.querySelector("svg");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 460 300");
      expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(container.querySelector(`#${gradientId}`)).toBeTruthy();
    });
  }

  it("shows the new room's plate after a route change", () => {
    mockPath = "/foods";
    const { container, rerender } = renderMotif();
    expect(container.querySelector("#foods-rim")).toBeTruthy();

    mockPath = "/glossary";
    rerender(
      <ThemeProvider initial={DEFAULT_THEME}>
        <RouteMotif />
      </ThemeProvider>,
    );
    expect(container.querySelector("#glossary-rim")).toBeTruthy();
  });

  it("still renders the plate when Chef's transition is off", () => {
    mockPath = "/plan";
    const { container } = renderMotif({ ...DEFAULT_THEME, transition: false });
    const svg = container.querySelector(".motif-frame svg");
    expect(svg).toBeTruthy();
    expect(container.querySelector("#plan-rim")).toBeTruthy();
  });
});
