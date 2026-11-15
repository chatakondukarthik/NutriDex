import type { AiConfig, ImagePart, ModelInfo, ModelRequest, ModelResponse, ProviderAdapter } from "./types";
import { getKey } from "./secrets";

const TIMEOUT_DEFAULT = 30_000;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function toBase64UrlSafe(s: string): string {
  return s;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { ...init, signal: timeoutSignal(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
}

// ---------- Gemini ----------

const gemini: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  async complete(config, request) {
    const key = getKey("gemini");
    if (!key) throw new Error("No Gemini key configured.");
    const model = config.model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

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
        ...(request.jsonSchema ? { responseMimeType: "application/json", responseSchema: request.jsonSchema } : {}),
      },
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    const start = Date.now();
    const json = await fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, request.timeoutMs ?? TIMEOUT_DEFAULT);
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
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: "GET" },
      20_000,
    );
    const models = (json?.models ?? []) as any[];
    return models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => ({
        id: (m.name as string).replace(/^models\//, ""),
        label: m.displayName ?? m.name,
        capabilities: ["text", "json", ...(m.description?.toLowerCase().includes("vision") ? ["vision"] : [])] as ModelInfo["capabilities"],
        contextTokens: m.inputTokenLimit,
      }));
  },
};

// ---------- OpenAI ----------

function openaiBaseUrl(config: AiConfig): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, "");
  return "https://api.openai.com/v1";
}

const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  async complete(config, request) {
    const key = getKey("openai");
    if (!key) throw new Error("No OpenAI key configured.");
    const url = `${openaiBaseUrl(config)}/chat/completions`;
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
    const key = getKey("openai");
    if (!key) throw new Error("No OpenAI key configured.");
    const json = await fetchJson(
      `${openaiBaseUrl(config)}/models`,
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
    const key = getKey("openai-compatible");
    if (!key) throw new Error("No key configured for the OpenAI-compatible provider.");
    if (!config.baseUrl) throw new Error("A base URL is required for an OpenAI-compatible provider.");
    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
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
    const key = getKey("openai-compatible");
    if (!key) throw new Error("No key configured for the OpenAI-compatible provider.");
    const json = await fetchJson(
      `${config.baseUrl.replace(/\/$/, "")}/models`,
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
