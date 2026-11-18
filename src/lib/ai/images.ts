/**
 * Image parts for AI calls.
 *
 * Server actions receive base64 images from the browser. Types, count,
 * total size and encoding are validated here before anything reaches a
 * provider — a server action is a public endpoint, so the browser's file
 * picker is not a trust boundary.
 *
 * The limits mirror the label-scan flow: up to 3 photos per call, 5 MB
 * each, 10 MB in total (12 MB once base64-inflated, plus envelope, sits
 * under the 16 MB action body cap).
 */

import type { ImagePart } from "./types";

export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 3;
export const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

export type ParsedImages =
  | { ok: true; images: ImagePart[] }
  | { ok: false; message: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function byteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length / 4) * 3) - padding;
}

/**
 * Accept `undefined` (no photos attached), or a handful of valid image
 * parts. Anything else is refused with a sentence the UI can show
 * verbatim.
 */
export function parseImageParts(raw: unknown): ParsedImages {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "That is not a valid image." };
  }
  if (raw.length === 0) return { ok: true, images: [] };
  if (raw.length > MAX_IMAGES) {
    return { ok: false, message: `At most ${MAX_IMAGES} photos per call.` };
  }

  const images: ImagePart[] = [];
  let total = 0;

  for (const part of raw) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return { ok: false, message: "That is not a valid image." };
    }
    const record = part as Record<string, unknown>;

    const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      return { ok: false, message: "That image type is not supported. Use JPEG, PNG, WebP or GIF." };
    }

    const data = typeof record.data === "string" ? record.data : "";
    if (data.length === 0) {
      return { ok: false, message: "That image is empty." };
    }
    // base64 encodes 3 bytes into 4 chars; a trailing = pads the remainder.
    if (data.length % 4 !== 0 || !BASE64.test(data)) {
      return { ok: false, message: "That image could not be read." };
    }
    const bytes = byteLength(data);
    if (bytes > MAX_IMAGE_BYTES) {
      return { ok: false, message: "One of those images is larger than 5 MB. Pick smaller ones." };
    }
    total += bytes;
    if (total > MAX_TOTAL_IMAGE_BYTES) {
      return { ok: false, message: "Those photos add up to more than 10 MB — attach fewer." };
    }

    images.push({ mimeType, data });
  }

  return { ok: true, images };
}
