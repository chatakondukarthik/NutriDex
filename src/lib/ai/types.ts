export type ProviderId = "gemini" | "openai" | "anthropic" | "openai-compatible";

export interface AiConfig {
  enabled?: boolean;
  provider: ProviderId;
  model: string;
  baseUrl?: string; // for openai-compatible (primary)
  fallbackProvider?: ProviderId;
  fallbackModel?: string;
  fallbackBaseUrl?: string;
  imageProvider?: ProviderId;
  imageModel?: string;
  imageBaseUrl?: string;
  imageFallbackProvider?: ProviderId;
  imageFallbackModel?: string;
  imageFallbackBaseUrl?: string;
  dailyCallCap?: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  capabilities: ("text" | "vision" | "json")[];
  contextTokens?: number;
}

export interface ImagePart {
  mimeType: string;
  data: string; // base64, no data: prefix
}

export interface ModelRequest {
  capability: "text" | "vision";
  system: string;
  prompt: string;
  images?: ImagePart[];
  jsonSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ModelResponse {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  complete(config: AiConfig, request: ModelRequest): Promise<ModelResponse>;
  listModels(config: AiConfig): Promise<ModelInfo[]>;
}
