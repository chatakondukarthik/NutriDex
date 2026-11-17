/**
 * Read a request body with a hard byte ceiling.
 *
 * `content-length` is a hint, not a guarantee: a chunked or header-less
 * upload can be any size, and `request.formData()` buffers the whole thing
 * before the route can inspect it. Reading the stream ourselves means an
 * oversized body is abandoned at the limit instead of being materialised.
 *
 * Returns `null` when the body exceeds `limit`.
 */
export async function readBodyWithLimit(
  request: Request,
  limit: number,
): Promise<Buffer | null> {
  const body = request.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          /* the stream may already be closed */
        }
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  return Buffer.concat(chunks);
}
