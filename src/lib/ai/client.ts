import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { readAiConfig, defaultAiConfig } from "./config";
import { getKey, hasKey } from "./secrets";
import { getAdapter } from "./adapters";
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

export async function complete(request: ModelRequest): Promise<ModelResponse> {
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

  // daily cap
  const cap = config.dailyCallCap ?? 200;
  const today = new Date().toISOString().slice(0, 10);
  const used = (
    db.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE created_at LIKE ?`).get(`${today}%`) as { n: number }
  ).n;
  if (used >= cap) {
    throw new Error("You have reached today's AI call limit. Raise it in Settings or try tomorrow.");
  }

  const attempts: AiConfig[] = [primary, ...(fallback ? [fallback] : [])];
  let lastError: Error | null = null;

  for (const cfg of attempts) {
    if (!hasKey(cfg.provider)) {
      lastError = new Error(`No key configured for ${cfg.provider}.`);
      continue;
    }
    const adapter = getAdapter(cfg.provider);
    const backoffs = [1000, 2000, 4000];
    for (let i = 0; i <= backoffs.length; i++) {
      try {
        const result = await adapter.complete(cfg, request);
        logCall(cfg, request, result, "ok", null);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const transient = /HTTP (429|500|502|503|529)/.test(err.message) || /timeout|aborted/i.test(err.message);
        lastError = err;
        if (!transient || i === backoffs.length) {
          logCall(cfg, request, null, "failed", err.message);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, backoffs[i]));
      }
    }
  }

  throw lastError ?? new Error("AI call failed.");
}

function logCall(
  cfg: AiConfig,
  request: ModelRequest,
  result: ModelResponse | null,
  status: string,
  error: string | null,
): void {
  try {
    db.prepare(
      `INSERT INTO ai_calls (id, provider, model, capability, prompt_tokens, completion_tokens, latency_ms, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      cfg.provider,
      cfg.model,
      request.capability,
      result?.promptTokens ?? null,
      result?.completionTokens ?? null,
      result?.latencyMs ?? null,
      status,
      error,
      new Date().toISOString(),
    );
  } catch {
    /* logging must never break a call */
  }
}

export function aiStatus(): AiStatus {
  const config = getAiConfig();
  const today = new Date().toISOString().slice(0, 10);
  const callsToday = (
    db.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE created_at LIKE ?`).get(`${today}%`) as { n: number }
  ).n;
  return {
    enabled: config.enabled !== false,
    configured: hasKey(config.provider),
    imageConfigured: !!(config.imageProvider && hasKey(config.imageProvider)),
    provider: config.provider,
    model: config.model,
    hasKey: hasKey(config.provider),
    fallback: config.fallbackProvider,
    dailyCap: config.dailyCallCap ?? 200,
    callsToday,
  };
}
