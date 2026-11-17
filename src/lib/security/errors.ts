/**
 * Server-action error hygiene.
 *
 * ~24 actions returned `error.message` verbatim to the client. Raw messages
 * carry file paths (`data/nutriplan.sqlite`), env var names, SQL fragments
 * and — in the AI layer — the first 400 characters of a provider response.
 * None of that belongs in a browser; the useful detail belongs in the server
 * log instead.
 *
 * Two rules:
 *   1. What reaches the client is a short, fixed, human sentence.
 *   2. What reaches the log is the real error, redacted of anything that
 *      looks like a key.
 */

/** Shapes we never let out, whatever the underlying error said. */
const LEAKY = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{10,}/g,
  /api[_-]?key\s*[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /x-api-key\s*[=:]\s*\S+/gi,
  /\/Users\/[^\s"']+/g,
  /\/home\/[^\s"']+/g,
  /\bdata\/[^\s"']+\.(sqlite|json)/g,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of LEAKY) out = out.replace(pattern, "[redacted]");
  return out;
}

/** Truncate and redact a message destined for the `ai_calls` log row. */
export function safeLogText(text: string | null, max = 300): string | null {
  if (text === null) return null;
  return redact(text).slice(0, max);
}

/**
 * An error whose message is written by the app for the user, not derived
 * from a provider, a file path or a SQL error. `publicError` passes these
 * through (redacted) instead of replacing them with a generic sentence.
 *
 * Only use this for fixed strings authored in this repository.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Errors that have already decided how they may be shown. The AI layer uses
 * this for provider HTTP failures: the status and the provider's own
 * explanation are more useful than "Connection failed.", and the message is
 * redacted and bounded where it is built.
 */
function publicMessageOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { publicMessage?: unknown }).publicMessage;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The message a user should see. `fallback` is a fixed sentence written at
 * the call site — never derived from the error.
 *
 * Logs the real (redacted) error so diagnosis stays possible.
 */
export function publicError(fallback: string, error: unknown, context?: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  const prefix = context ? `[${context}] ` : "";
  console.error(`${prefix}${redact(detail)}`);
  if (error instanceof UserFacingError) return redact(detail);
  const opted = publicMessageOf(error);
  if (opted) return redact(opted);
  return fallback;
}

/**
 * Reads a `message` field out of a known-shape failure and sanitises it,
 * for the cases where the app's own validation messages are the useful
 * answer (they are fixed strings we wrote, not third-party text).
 */
export function ownMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && error.message.length <= 200) {
    return redact(error.message);
  }
  return fallback;
}
