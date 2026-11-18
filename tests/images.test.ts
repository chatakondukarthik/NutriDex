import { describe, expect, it } from "vitest";
import {
  MAX_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  parseImageParts,
} from "@/lib/ai/images";

/**
 * Server actions receive base64 images from the browser, so the parser is
 * the trust boundary between a file picker and a paid AI call.
 */

const VALID = Buffer.alloc(32, 7).toString("base64");

function oversized(): string {
  // One extra 3-byte group over the 5 MB per-image cap.
  return Buffer.alloc(5 * 1024 * 1024 + 3, 1).toString("base64");
}

function manyTotal(): string[] {
  // Three images of just over 4 MB each: valid per-image, over the 10 MB total.
  const each = Buffer.alloc(4 * 1024 * 1024 + 600 * 1024, 1).toString("base64");
  return [each, each, each];
}

describe("parseImageParts", () => {
  it("accepts no photo at all", () => {
    expect(parseImageParts(undefined)).toEqual({ ok: true, images: [] });
    expect(parseImageParts(null)).toEqual({ ok: true, images: [] });
  });

  it("accepts up to three images and keeps their bytes verbatim", () => {
    const input = Array.from({ length: MAX_IMAGES }, () => ({
      mimeType: "image/png",
      data: VALID,
    }));
    const result = parseImageParts(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.images).toEqual(input);
  });

  it("refuses a fourth image", () => {
    const input = Array.from({ length: MAX_IMAGES + 1 }, () => ({
      mimeType: "image/png",
      data: VALID,
    }));
    const result = parseImageParts(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/at most 3/i);
  });

  it("refuses images whose total exceeds 10 MB", () => {
    const result = parseImageParts(
      manyTotal().map((data) => ({ mimeType: "image/png", data })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/more than 10 MB/i);
  });

  it("accepts jpeg, webp and gif but not other image types", () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(parseImageParts([{ mimeType, data: VALID }]).ok).toBe(true);
    }
    for (const mimeType of ["image/tiff", "image/svg+xml", "image/bmp", "application/pdf"]) {
      const result = parseImageParts([{ mimeType, data: VALID }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/not supported/i);
    }
  });

  it("refuses data that is not base64", () => {
    for (const data of ["!!!", "abc", "a===", "====", "a b c d"]) {
      const result = parseImageParts([{ mimeType: "image/png", data }]);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses one image larger than 5 MB", () => {
    const result = parseImageParts([{ mimeType: "image/png", data: oversized() }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/larger than 5 MB/i);
  });

  it("refuses malformed parts", () => {
    expect(parseImageParts("not an array").ok).toBe(false);
    expect(parseImageParts([null]).ok).toBe(false);
    expect(parseImageParts([["image/png"]]).ok).toBe(false);
    expect(parseImageParts([{ mimeType: "image/png" }]).ok).toBe(false);
    expect(parseImageParts([{ data: VALID }]).ok).toBe(false);
    expect(parseImageParts([{ mimeType: "image/png", data: 42 }]).ok).toBe(false);
  });

  it("exports the total cap the client mirrors", () => {
    expect(MAX_TOTAL_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});
