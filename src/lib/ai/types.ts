export type ProviderId = "gemini" | "openai" | "anthropic" | "openai-compatible";

export interface AiConfig {
  provider: ProviderId;
  model: string;
  fallbackProvider?: ProviderId;
  fallbackModel?: string;
  baseUrl?: string; // for openai-compatible
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
