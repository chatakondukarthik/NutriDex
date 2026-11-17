import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupBarcode, offToInput } from "@/lib/food-sources/openfoodfacts";

/**
 * S6.2 — barcode lookup.
 *
 * Open Food Facts is untrusted input: the barcode is validated before a
 * request exists, the body is capped before parsing, and every value that
 * survives is marked with its source and the label's basis. The product
 * record becomes a proposal, never a stored fact.
 */

function productResponse(product: Record<string, unknown>) {
  return new Response(JSON.stringify({ status: 1, product }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupBarcode", () => {
  it("refuses a non-barcode without making a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await lookupBarcode("not-a-barcode")).toBeNull();
    expect(await lookupBarcode("123")).toBeNull();
    expect(await lookupBarcode("123456789012345")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps per-100 g nutrients and the label's serving", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      productResponse({
        product_name: "Whole wheat biscuits",
        brands: "Example Foods",
        categories_tags: ["en:Biscuits"],
        image_url: "https://images.openfoodfacts.org/example.jpg",
        serving_quantity: 30,
        serving_size: "2 biscuits",
        nutriments: {
          "energy-kcal_100g": 420,
          proteins_100g: 9,
          fat_100g: 14,
          carbohydrates_100g: 66,
          fiber_100g: 7,
          sugars_100g: 12,
          sodium_100g: 0.4,
          "vitamin-c_100g": 0,
        },
      }),
    );

    const product = await lookupBarcode("8901234567890");
    expect(product).toMatchObject({
      code: "8901234567890",
      name: "Whole wheat biscuits",
      brand: "Example Foods",
      basis: "per_100g",
      servingSizeG: 30,
      servingLabel: "2 biscuits",
      nutrients: {
        ENERC_KCAL: 420,
        PROCNT: 9,
        FAT: 14,
        CHOCDF: 66,
        FIBTG: 7,
        SUGAR: 12,
        NA: 0.4,
        VITC: 0,
      },
    });

    const input = offToInput(product!);
    expect(input).toMatchObject({
      name: "Whole wheat biscuits (Example Foods)",
      source: "openfoodfacts",
      sourceCode: "8901234567890",
      basis: "per_100g",
      servingSizeG: 30,
      imagePath: "https://images.openfoodfacts.org/example.jpg",
    });
    expect(input.portions).toEqual([{ label: "1 2 biscuits", grams: 30, source: "label serving" }]);
  });

  it("derives sodium from salt when sodium is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      productResponse({
        product_name: "Salted snack",
        nutriments: { salt_100g: 1.5 },
      }),
    );

    const product = await lookupBarcode("8901234567890");
    expect(product?.nutrients.NA).toBe(600);
  });

  it("does not turn a plain weight serving into a named portion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      productResponse({
        product_name: "Yoghurt",
        serving_quantity: 100,
        serving_size: "100 g",
        nutriments: {},
      }),
    );

    const input = offToInput((await lookupBarcode("8901234567890"))!);
    expect(input.servingSizeG).toBe(100);
    expect(input.portions).toBeUndefined();
  });

  it("returns null for a missing product, a failed request or a broken body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 0 }), { status: 200 }),
    );
    expect(await lookupBarcode("8901234567890")).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    expect(await lookupBarcode("8901234567890")).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(lookupBarcode("8901234567890")).rejects.toThrow();
  });

  it("refuses a response over the size cap before parsing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(5_000_001), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(lookupBarcode("8901234567890")).rejects.toThrow(/too large/);
  });

  it("sends a descriptive User-Agent and a bounded timeout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      productResponse({ product_name: "Thing", nutriments: {} }),
    );

    await lookupBarcode("8901234567890");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/NutriPlan/);
    expect(init.signal).toBeDefined();
  });
});
