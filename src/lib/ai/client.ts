import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { readAiConfig, defaultAiConfig } from "./config";
import { getKey, hasKey } from "./secrets";
import { getAdapter } from "./adapters";
import { safeLogText } from "@/lib/security/errors";
import type { AiConfig, ModelRequest, ModelResponse, ProviderId } from "./types";

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  imageConfigured: boolean;
  provider: string;
  model: string;
  hasKey: boolean;
  fallback?: string;
  dailyCap: number;
  callsToday: number;
}

export const DEFAULT_DAILY_CAP = 200;
const MAX_DAILY_CAP = 10_000;

/**
 * The cap is read back from a file a server action writes, so it is
 * clamped here rather than trusted: a negative or `Infinity` value used
 * to turn the only cost brake into a no-op (`Infinity >= used` is never
 * true), and a nonsense string did the same by making the comparison
 * always false.
 */
export function clampDailyCap(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.min(MAX_DAILY_CAP, Math.max(1, Math.floor(n)));
}

export function effectiveDailyCap(config: AiConfig): number {
  return clampDailyCap(config.dailyCallCap ?? DEFAULT_DAILY_CAP);
}

export function getAiConfig(): AiConfig {
  const config = readAiConfig() ?? defaultAiConfig();
  if (config.enabled === undefined) config.enabled = true;
  return config;
}

export function isAiEnabled(): boolean {
  return getAiConfig().enabled !== false;
}

export interface ResolvedProvider {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
}

export function primaryFor(config: AiConfig, capability: "text" | "vision"): ResolvedProvider {
  if (capability === "vision" && config.imageProvider && config.imageModel) {
    return { provider: config.imageProvider, model: config.imageModel, baseUrl: config.imageBaseUrl };
  }
  return { provider: config.provider, model: config.model, baseUrl: config.baseUrl };
}

export function fallbackFor(config: AiConfig, capability: "text" | "vision"): ResolvedProvider | null {
  if (capability === "vision" && config.imageFallbackProvider && config.imageFallbackModel) {
    return {
      provider: config.imageFallbackProvider,
      model: config.imageFallbackModel,
      baseUrl: config.imageFallbackBaseUrl,
    };
  }
  if (config.fallbackProvider && config.fallbackModel) {
    return { provider: config.fallbackProvider, model: config.fallbackModel, baseUrl: config.fallbackBaseUrl };
  }
  return null;
}

export function isProviderConfigured(provider: string): boolean {
  return hasKey(provider);
}

function todayStamp(): string {
  return `${new Date().toISOString().slice(0, 10)}%`;
}

export function callsToday(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE created_at LIKE ?`).get(todayStamp()) as { n: number }
  ).n;
}

/**
 * Atomically claim one slot of today's budget.
 *
 * The old check-then-insert (`COUNT(*)` … later `INSERT`) let any number
 * of concurrent requests all observe the same count and all proceed. This
 * reserves the row in a single statement, so the write lock makes the
 * claim exclusive; a rejected claim inserts nothing (`changes === 0`).
 *
 * Returns the row id to finalise with, or `null` when the cap is spent.
 */
function reserveCallSlot(cfg: AiConfig, request: ModelRequest): string | null {
  const id = randomUUID();
  try {
    const result = db
      .prepare(
        `INSERT INTO ai_calls (id, provider, model, capability, status, created_at)
         SELECT ?, ?, ?, ?, 'pending', ?
         WHERE (SELECT COUNT(*) FROM ai_calls WHERE created_at LIKE ?) < ?`,
      )
      .run(
        id,
        cfg.provider,
        cfg.model,
        request.capability,
        new Date().toISOString(),
        todayStamp(),
        effectiveDailyCap(cfg),
      );
    return result.changes > 0 ? id : null;
  } catch {
    // A logging failure must not become a silent bypass of the budget.
    return null;
  }
}

function finalizeCall(
  id: string,
  cfg: AiConfig,
  request: ModelRequest,
  result: ModelResponse | null,
  status: string,
  error: string | null,
): void {
  try {
    db.prepare(
      `UPDATE ai_calls SET prompt_tokens = ?, completion_tokens = ?, latency_ms = ?, status = ?, error = ?
       WHERE id = ?`,
    ).run(
      result?.promptTokens ?? null,
      result?.completionTokens ?? null,
      result?.latencyMs ?? null,
      status,
      safeLogText(error),
      id,
    );
  } catch {
    /* logging must never break a call */
  }
}

/**
 * Budget gate for outbound calls that bypass `complete()` — the connection
 * test, the custom-provider test and the model lister. All three used to
 * hit the provider uncounted, which made the daily cap decorative.
 */
export async function withAiBudget<T>(
  capability: "text" | "vision",
  fn: () => Promise<T>,
): Promise<T> {
  const config = getAiConfig();
  if (config.enabled === false) throw new Error("AI is turned off in Settings.");
  const slot = reserveCallSlot({ ...config, provider: config.provider, model: config.model }, {
    capability,
    system: "",
    prompt: "",
  });
  if (!slot) throw new Error("You have reached today's AI call limit. Raise it in Settings or try tomorrow.");
  try {
    const out = await fn();
    finalizeCall(slot, config, { capability, system: "", prompt: "" }, null, "probe", null);
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finalizeCall(slot, config, { capability, system: "", prompt: "" }, null, "failed", message);
    throw error;
  }
}

const LIMIT_MESSAGE = "You have reached today's AI call limit. Raise it in Settings or try tomorrow.";

export async function complete(
  request: ModelRequest,
  options?: { preferFallback?: boolean },
): Promise<ModelResponse> {
  const config = getAiConfig();
  if (config.enabled === false) throw new Error("AI is turned off in Settings.");

  const primaryResolved = primaryFor(config, request.capability);
  const fallbackResolved = fallbackFor(config, request.capability);

  const primary: AiConfig = {
    ...config,
    provider: primaryResolved.provider,
    model: primaryResolved.model,
    baseUrl: primaryResolved.baseUrl,
  };
  const fallback: AiConfig | null = fallbackResolved
    ? { ...config, provider: fallbackResolved.provider, model: fallbackResolved.model, baseUrl: fallbackResolved.baseUrl }
    : null;

  const attempts: AiConfig[] =
    options?.preferFallback && fallback
      ? [fallback, primary]
      : [primary, ...(fallback ? [fallback] : [])];
  let lastError: Error | null = null;

  for (const cfg of attempts) {
    if (!hasKey(cfg.provider)) {
      lastError = new Error(`No key configured for ${cfg.provider}.`);
      continue;
    }
    let adapter;
    try {
      adapter = getAdapter(cfg.provider);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    const backoffs = [1000, 2000, 4000];
    for (let i = 0; i <= backoffs.length; i++) {
      // Reserved per outbound attempt: retries are real spend, and a
      // rejected claim stops the whole chain instead of slipping past.
      const slot = reserveCallSlot(cfg, request);
      if (!slot) throw new Error(LIMIT_MESSAGE);
      try {
        const result = await adapter.complete(cfg, request);
        finalizeCall(slot, cfg, request, result, "ok", null);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const transient = /HTTP (429|500|502|503|529)/.test(err.message) || /timeout|aborted/i.test(err.message);
        finalizeCall(slot, cfg, request, null, "failed", err.message);
        lastError = err;
        if (!transient || i === backoffs.length) break;
        await new Promise((resolve) => setTimeout(resolve, backoffs[i]));
      }
    }
  }

  throw lastError ?? new Error("AI call failed.");
}

export function aiStatus(): AiStatus {
  const config = getAiConfig();
  return {
    enabled: config.enabled !== false,
    configured: hasKey(config.provider),
    imageConfigured: !!(config.imageProvider && hasKey(config.imageProvider)),
    provider: config.provider,
    model: config.model,
    hasKey: hasKey(config.provider),
    fallback: config.fallbackProvider,
    dailyCap: effectiveDailyCap(config),
    callsToday: callsToday(),
  };
}
