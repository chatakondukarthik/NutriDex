import type { AiConfig, ImagePart, ModelInfo, ModelRequest, ModelResponse, ProviderAdapter } from "./types";
import { getKey, getKeyForHost } from "./secrets";
import { assertOutboundUrl } from "@/lib/security/urls";
import { redact, UserFacingError } from "@/lib/security/errors";
import { ProviderHttpError, ProviderNetworkError, ProviderTimeoutError } from "./errors";

const TIMEOUT_DEFAULT = 30_000;

/** BYO_LLM §11: cap the body before we buffer or parse it. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * `AbortSignal.timeout` clears its own timer once the request settles —
 * the old AbortController + setTimeout left a pending timer alive for up
 * to 30s after every call.
 */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response too large (${declared} bytes).`);
  }
  const reader = res.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Response too large (over ${maxBytes} bytes).`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Pull the provider's own explanation out of an error body.
 *
 * Gemini, OpenAI and Anthropic all use `{ error: { message } }`; a few
 * compatible servers put a bare `message` at the top level. Anything else
 * (an HTML error page from a proxy, say) falls back to the raw body, which
 * `ProviderHttpError` redacts and truncates.
 */
function providerDetail(text: string): string {
  try {
    const json = JSON.parse(text);
    const message = json?.error?.message ?? json?.message ?? json?.error;
    if (typeof message === "string") return message;
  } catch {
    // Not JSON.
  }
  return text;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  // `redirect: "error"` is load-bearing, not tidiness: `fetch` follows
  // redirects by default, and the SSRF guard validates only the URL it was
  // given. A public endpoint could 302 to `169.254.169.254` or to an
  // attacker host and carry the Authorization header there. A redirect is
  // never legitimate for these APIs, so refuse it.
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      redirect: "error",
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    // `AbortSignal.timeout` rejects with a DOMException named TimeoutError.
    // Everything else is DNS/TLS/connection failure or a refused redirect.
    if ((error as { name?: string })?.name === "TimeoutError") {
      throw new ProviderTimeoutError(timeoutMs);
    }
    throw new ProviderNetworkError();
  }
  const text = await readCapped(res, MAX_RESPONSE_BYTES);
  if (!res.ok) {
    // Provider bodies reach the client through test/estimate errors, so
    // they are redacted and truncated here rather than trusted upstream.
    throw new ProviderHttpError(res.status, providerDetail(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${redact(text).slice(0, 200)}`);
  }
}

// ---------- Gemini ----------

function stripAdditionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAdditionalProperties);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "additionalProperties") continue;
      out[k] = stripAdditionalProperties(v);
    }
    return out;
  }
  return value;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const gemini: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  async complete(config, request) {
    const key = getKey("gemini");
    if (!key) throw new Error("No Gemini key configured.");
    const model = config.model || "gemini-flash-latest";
    // The key travels as a header, never in the query string: URLs end up
    // in proxy/CDN/access logs and in any error that echoes the request.
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;

    const parts: any[] = [];
    if (request.images?.length) {
      for (const img of request.images) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    parts.push({ text: request.prompt });

    const body: any = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: request.temperature ?? 0,
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
        ...(request.jsonSchema ? { responseMimeType: "application/json", responseSchema: stripAdditionalProperties(request.jsonSchema) } : {}),
      },
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    const start = Date.now();
    const json = await fetchJson(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
      request.timeoutMs ?? TIMEOUT_DEFAULT,
    );
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    return {
      text,
      promptTokens: json?.usageMetadata?.promptTokenCount,
      completionTokens: json?.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - start,
    };
  },
  async listModels(config) {
    const key = getKey("gemini");
    if (!key) throw new Error("No Gemini key configured.");
    const json = await fetchJson(
      `${GEMINI_BASE}/models`,
      { method: "GET", headers: { "x-goog-api-key": key } },
      20_000,
    );
    const models = (json?.models ?? []) as any[];
    return models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => {
        const id = (m.name as string).replace(/^models\//, "");
        return {
          id,
          label: m.displayName ?? id,
          capabilities: ["text", "json", ...(m.description?.toLowerCase().includes("vision") ? ["vision"] : [])] as ModelInfo["capabilities"],
          contextTokens: m.inputTokenLimit,
        };
      });
  },
};

// ---------- OpenAI ----------

/**
 * Every custom endpoint is re-validated here, at the moment a key is about
 * to be attached — the stored config and a caller-supplied test URL are both
 * untrusted, and this is the last place the check can run.
 */
async function safeBaseUrl(raw: string | undefined, fallback: string): Promise<string> {
  if (!raw) return fallback;
  return assertOutboundUrl(raw);
}

/**
 * Key lookup for a caller-supplied endpoint.
 *
 * A fixed provider endpoint (`api.openai.com`) uses `getKey`. A custom
 * `baseUrl` is different: the key is released only if it was entered for
 * that exact host. Repointing the base URL at another host therefore fails
 * closed with "re-enter the key" instead of silently posting the stored key
 * to the new destination.
 */
function keyForEndpoint(provider: string, base: string, custom: boolean): string | null {
  if (!custom) return getKey(provider);
  return getKeyForHost(provider, new URL(base).host);
}

function requireKey(key: string | null, label: string, base: string, custom: boolean): string {
  if (key) return key;
  if (custom) {
    throw new UserFacingError(
      `No ${label} key is bound to ${new URL(base).host}. ` +
        `Re-enter the key in Settings to use this endpoint.`,
    );
  }
  throw new UserFacingError(`No ${label} key configured.`);
}

const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  async complete(config, request) {
    const custom = !!config.baseUrl;
    const base = await safeBaseUrl(config.baseUrl, "https://api.openai.com/v1");
    const key = requireKey(keyForEndpoint("openai", base, custom), "OpenAI", base, custom);
    const url = `${base}/chat/completions`;
    const content: any[] = [];
    if (request.images?.length) {
      for (const img of request.images) {
        content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      }
    }
    content.push({ type: "text", text: request.prompt });

    const body: any = {
      model: config.model,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content },
      ],
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    };
    if (request.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: "result", schema: request.jsonSchema, strict: true } };
    }

    const start = Date.now();
    const json = await fetchJson(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) },
      request.timeoutMs ?? TIMEOUT_DEFAULT,
    );
    const text = json?.choices?.[0]?.message?.content ?? "";
    return {
      text,
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  },
  async listModels(config) {
    const custom = !!config.baseUrl;
    const base = await safeBaseUrl(config.baseUrl, "https://api.openai.com/v1");
    const key = requireKey(keyForEndpoint("openai", base, custom), "OpenAI", base, custom);
    const json = await fetchJson(
      `${base}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${key}` } },
      20_000,
    );
    const models = (json?.data ?? []) as any[];
    return models.map((m) => ({
      id: m.id,
      label: m.id,
      capabilities: ["text", "json", "vision"],
    }));
  },
};

// ---------- Anthropic ----------

const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic Claude",
  async complete(config, request) {
    const key = getKey("anthropic");
    if (!key) throw new Error("No Anthropic key configured.");
    const url = "https://api.anthropic.com/v1/messages";
    const content: any[] = [];
    if (request.images?.length) {
      for (const img of request.images) {
        content.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } });
      }
    }
    content.push({ type: "text", text: request.prompt });

    const body: any = {
      model: config.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0,
      messages: [{ role: "user", content }],
    };
    if (request.system) body.system = request.system;
    if (request.jsonSchema) {
      body.tools = [{ name: "respond", description: "Respond with JSON", input_schema: request.jsonSchema }];
      body.tool_choice = { type: "tool", name: "respond" };
    }

    const start = Date.now();
    const json = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs ?? TIMEOUT_DEFAULT,
    );

    let text = "";
    if (request.jsonSchema) {
      const toolUse = (json?.content ?? []).find((c: any) => c.type === "tool_use");
      if (toolUse) text = JSON.stringify(toolUse.input ?? {});
    } else {
      text = (json?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    }
    return {
      text,
      promptTokens: json?.usage?.input_tokens,
      completionTokens: json?.usage?.output_tokens,
      latencyMs: Date.now() - start,
    };
  },
  async listModels(config) {
    // Anthropic has no list endpoint; return a small known set.
    return [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", capabilities: ["text", "vision", "json"] },
      { id: "claude-haiku-4-20250414", label: "Claude Haiku 4", capabilities: ["text", "vision", "json"] },
      { id: "claude-opus-4-20250514", label: "Claude Opus 4", capabilities: ["text", "vision", "json"] },
    ];
  },
};

// ---------- OpenAI-compatible ----------

const openaiCompatible: ProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-compatible",
  async complete(config, request) {
    if (!config.baseUrl) throw new Error("A base URL is required for an OpenAI-compatible provider.");
    const base = await safeBaseUrl(config.baseUrl, "");
    const key = requireKey(
      keyForEndpoint("openai-compatible", base, true),
      "OpenAI-compatible",
      base,
      true,
    );
    const url = `${base}/chat/completions`;
    const content: any[] = [];
    if (request.images?.length) {
      for (const img of request.images) {
        content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      }
    }
    content.push({ type: "text", text: request.prompt });
    const body: any = {
      model: config.model,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content },
      ],
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    };
    if (request.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: "result", schema: request.jsonSchema, strict: true } };
    }
    const start = Date.now();
    const json = await fetchJson(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) },
      request.timeoutMs ?? 30_000,
    );
    const text = json?.choices?.[0]?.message?.content ?? "";
    return {
      text,
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  },
  async listModels(config) {
    if (!config.baseUrl) throw new Error("A base URL is required.");
    const base = await safeBaseUrl(config.baseUrl, "");
    const key = requireKey(
      keyForEndpoint("openai-compatible", base, true),
      "OpenAI-compatible",
      base,
      true,
    );
    const json = await fetchJson(
      `${base}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${key}` } },
      20_000,
    );
    const models = (json?.data ?? []) as any[];
    return models.map((m) => ({ id: m.id, label: m.id, capabilities: ["text", "json", "vision"] }));
  },
};

export const ADAPTERS: Record<string, ProviderAdapter> = {
  gemini,
  openai,
  anthropic,
  "openai-compatible": openaiCompatible,
};

export function getAdapter(provider: string): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown provider: ${provider}`);
  return adapter;
}
