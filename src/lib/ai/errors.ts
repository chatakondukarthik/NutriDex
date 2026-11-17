import { redact, UserFacingError } from "@/lib/security/errors";

/**
 * Provider failures that are worth showing the user.
 *
 * `publicError` replaces unknown errors with a fixed sentence on purpose —
 * provider bodies can carry keys, hostnames and file paths. But "Connection
 * failed." is useless when the provider actually said *which* model does not
 * exist. These classes opt in to a bounded, redacted `publicMessage`; every
 * other error keeps the generic fallback.
 *
 * The detail is flattened to one line, capped at 200 characters and passed
 * through `redact` before it can leave the server.
 */

const MAX_DETAIL = 200;

export function sanitizeProviderDetail(text: string): string {
  return redact(text).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL);
}

export class ProviderHttpError extends Error {
  readonly publicMessage: string;

  constructor(
    readonly status: number,
    detail: string,
  ) {
    const clean = sanitizeProviderDetail(detail);
    super(clean ? `HTTP ${status}: ${clean}` : `HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.publicMessage = clean
      ? `Provider returned HTTP ${status}: ${clean}`
      : `Provider returned HTTP ${status}.`;
  }
}

export class ProviderTimeoutError extends Error {
  readonly publicMessage: string;

  constructor(readonly timeoutMs: number) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(`Provider did not respond within ${seconds}s.`);
    this.name = "ProviderTimeoutError";
    this.publicMessage =
      `The provider did not respond within ${seconds} s. ` +
      "Try again, or choose a model with more capacity.";
  }
}

export class ProviderNetworkError extends Error {
  readonly publicMessage =
    "Could not reach the provider. Check the base URL and your network connection.";

  constructor() {
    super("Provider request failed before a response was received.");
    this.name = "ProviderNetworkError";
  }
}

/** The categories the settings panel shows next to a failed test. */
export type AiFailureKind = "http" | "timeout" | "network" | "config" | "unknown";

export interface AiFailureInfo {
  kind: AiFailureKind;
  /** One sentence for the UI. Never contains a key. */
  message: string;
  /** One line a user can copy and send to a developer. Redacted and bounded. */
  detail: string;
}

export interface AiFailureContext {
  action: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
}

function hostOf(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function classify(error: unknown): { kind: AiFailureKind; message: string } {
  if (error instanceof ProviderHttpError) return { kind: "http", message: error.publicMessage };
  if (error instanceof ProviderTimeoutError) {
    return { kind: "timeout", message: error.publicMessage };
  }
  if (error instanceof ProviderNetworkError) {
    return { kind: "network", message: error.publicMessage };
  }
  if (error instanceof UserFacingError) {
    return { kind: "config", message: redact(error.message) };
  }
  return { kind: "unknown", message: "" };
}

/**
 * Build the failure a server action returns.
 *
 * The log keeps the full redacted error; the client gets a category, a
 * sentence, and a single copyable line. The key never appears in any of
 * them — `sanitizeProviderDetail` redacts before the string is assembled.
 */
export function aiFailure(
  fallback: string,
  error: unknown,
  context: AiFailureContext,
): AiFailureInfo {
  const raw = error instanceof Error ? error.message : String(error);
  console.error(`[${context.action}] ${redact(raw)}`);

  const { kind, message } = classify(error);
  return {
    kind,
    message: message || fallback,
    detail: detailLine(context, kind, sanitizeProviderDetail(raw) || "unknown"),
  };
}

/**
 * A failure the app detected itself: no key, bad base URL, unknown provider.
 * Same copyable shape as a provider failure, so the panel has one renderer.
 */
export function aiConfigFailure(
  message: string,
  context: AiFailureContext,
): AiFailureInfo {
  return { kind: "config", message, detail: detailLine(context, "config", message) };
}

function detailLine(context: AiFailureContext, kind: AiFailureKind, message: string): string {
  const host = hostOf(context.baseUrl);
  const fields = [
    `action=${context.action}`,
    `type=${kind}`,
    context.provider ? `provider=${context.provider}` : null,
    context.model ? `model=${context.model}` : null,
    host ? `host=${host}` : null,
    `message=${message}`,
  ].filter((field): field is string => Boolean(field));
  return `${new Date().toISOString()} ${fields.join(" | ")}`.slice(0, 600);
}
