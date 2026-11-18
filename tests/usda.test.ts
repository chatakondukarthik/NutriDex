import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * USDA visibility. A search that comes back empty must be tellable from
 * USDA being rate-limited or down — the user launches a search expecting
 * answers, not silence. Both paths are exercised through the server action
 * with a mocked global fetch.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

const PNG = Buffer.alloc(8, 1).toString("base64");

const SEARCH_RESPONSE = {
  foods: [
    {
      fdcId: 170567,
      description: "Nuts, almonds",
      dataType: "SR Legacy",
      foodCategory: "Nut and Seed Products",
      publishedDate: "2019-04-01",
      foodNutrients: [
        { nutrientId: 1008, value: 579 },
        { nutrientId: 1003, value: 21.2 },
        { nutrientId: 1004, value: 49.9 },
        { nutrientId: 1005, value: 21.6 },
        { nutrientId: 1079, value: 12.5 },
        { nutrientId: 2000, value: 4.4 },
        { nutrientId: 1093, value: 1 },
        { nutrientId: 1092, value: 733 },
        { nutrientId: 1087, value: 269 },
        { nutrientId: 1089, value: 3.71 },
        { nutrientId: 1095, value: 3.12 },
        { nutrientId: 1090, value: 270 },
        { nutrientId: 1162, value: 0 },
        { nutrientId: 1114, value: 0.1 },
        { nutrientId: 1178, value: 0 },
        { nutrientId: 1177, value: 44 },
        { nutrientId: 1175, value: 0.137 },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  cookieJar.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchUsdaAction", () => {
  it("maps a USDA hit to the import shape with dataType, date and ids", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(SEARCH_RESPONSE));
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("almonds");
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]).toMatchObject({
      fdcId: 170567,
      name: "Nuts, almonds",
      dataType: "SR Legacy",
      publishedDate: "2019-04-01",
      nutrients: 17,
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("sortBy=score");
    expect(url).toContain("query=almonds");
  });

  it("passes dataType and sort to the API query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ foods: [] }));
    const { searchUsdaAction } = await import("@/app/actions");

    await searchUsdaAction("almonds", { dataType: "SR Legacy,Foundation", sortBy: "description" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("dataType=SR+Legacy%2CFoundation");
    expect(url).toContain("sortBy=description");
    expect(url).toContain("sortOrder=asc");
  });

  it("truly has no matches — ok with an empty list, not an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ foods: [] }));
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("zzzz-no-such-food");
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("says the USDA rate limit was hit when USDA answers 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: { code: "OVER_RATE_LIMIT", message: "You have exceeded your rate limit" } },
        429,
      ),
    );
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("almonds");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate limit/i);
    expect(result.message).toMatch(/NUTRIPLAN_USDA_KEY/);
  });

  it("says USDA refused the request on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 403));
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("almonds");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/refused|key/i);
  });

  it("says USDA is down on 5xx, not 'no matches'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503));
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("almonds");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/503|trouble/i);
  });

  it("says USDA could not complete the request on a malformed response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("this is not json", { status: 200 }),
    );
    const { searchUsdaAction } = await import("@/app/actions");

    const result = await searchUsdaAction("almonds");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/search failed/i);
  });

  it("surfaces the USDA error to the import path too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: {} }, 429));
    const { importUsdaAction } = await import("@/app/actions");

    const result = await importUsdaAction(170567);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate limit/i);
  });

  it("refuses a non-integer fdcId before any request", async () => {
    const { importUsdaAction } = await import("@/app/actions");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await importUsdaAction(1.5 as never);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
