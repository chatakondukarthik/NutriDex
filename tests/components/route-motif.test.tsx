import { render, waitFor } from "@testing-library/react";
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

describe("RouteMotif — the seven transitions", () => {
  const IDS = ["fold", "bloom", "ember", "blossom", "spin", "rim", "tawa"];

  it("marks the entering plate with a variant from the set", () => {
    mockPath = "/foods";
    const { container } = renderMotif();
    const el = container.querySelector("[data-variant]");
    expect(IDS).toContain(el?.getAttribute("data-variant"));
  });

  it("marks the plain swap 'off' when Chef's transition is off", () => {
    mockPath = "/foods";
    const { container } = renderMotif({ ...DEFAULT_THEME, transition: false });
    expect(container.querySelector("[data-variant]")?.getAttribute("data-variant")).toBe("off");
  });

  it("picks the next variant deterministically when random is mocked", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99); // → options[5] → 'tawa'
    mockPath = "/foods";
    const { container, rerender } = renderMotif();
    mockPath = "/glossary";
    rerender(
      <ThemeProvider initial={DEFAULT_THEME}>
        <RouteMotif />
      </ThemeProvider>,
    );
    const els = container.querySelectorAll("[data-variant]");
    expect(els[els.length - 1]?.getAttribute("data-variant")).toBe("tawa");
    spy.mockRestore();
  });

  it("never plays the same variant twice in a row across route changes", async () => {
    mockPath = "/";
    const { container, rerender } = renderMotif();
    const seen: string[] = [];
    for (const r of ["/plan", "/foods", "/recipes", "/profile", "/about", "/glossary", "/"]) {
      mockPath = r;
      rerender(
        <ThemeProvider initial={DEFAULT_THEME}>
          <RouteMotif />
        </ThemeProvider>,
      );
      // let the 0.26s universal exit finish — in real use, exits complete
      // long before a human taps the next tab
      await waitFor(() => expect(container.querySelectorAll("[data-variant]").length).toBe(1));
      const v = container.querySelector("[data-variant]")?.getAttribute("data-variant");
      if (v && v !== "off") seen.push(v);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
  });
});
