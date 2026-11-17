/**
 * Token-bucket rate limits for outbound-facing server actions.
 *
 * The AI layer has a daily budget; USDA and Open Food Facts have none, and
 * an unauthenticated caller can burn the shared `DEMO_KEY` quota or pin
 * server sockets with sequential 10-second upstream calls. These actions
 * are cheap to throttle in-process — the app is single-user, so a bucket
 * only ever trips when one client is looping.
 *
 * Not a security boundary on its own: the real boundary is the proxy gate.
 * This keeps an accidental or scripted loop from consuming upstream quota.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimit {
  ok: boolean;
  /** Seconds until a token is available again. */
  retryAfter?: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimit {
  const now = Date.now();
  const refill = ((now - (buckets.get(key)?.updatedAt ?? now)) / windowMs) * limit;
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  bucket.tokens = Math.min(limit, bucket.tokens + (buckets.get(key) ? refill : 0));
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const waitMs = ((1 - bucket.tokens) / limit) * windowMs;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { ok: true };
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
