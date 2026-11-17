/**
 * Pure logic behind the request gate in `src/proxy.ts`.
 *
 * Split out so it can be tested without a Next request object — the first
 * version forgot to strip `:3000` from `Host` and locked the app out of its
 * own browser, which a unit test would have caught.
 *
 * Threat model, stated once: this app has no authentication by design (one
 * implicit local user). The gate is not an auth system. It is a fail-closed
 * default so that "start the dev server" does not publish every recipe,
 * food and the stored AI key to the LAN, and so a proxy that rewrites `Host`
 * to its loopback upstream cannot make the gate decorative.
 */

export type GateMode = "local" | "token" | "hosts" | "off";

/**
 * Hosts that mean "this machine".
 *
 * `0.0.0.0` is deliberately absent: it is a *bind address*, never a
 * destination a browser or a proxy addresses. Treating it as loopback let a
 * caller send `Host: 0.0.0.0` and be trusted.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "ip6-localhost"]);

/**
 * The hostname a request was addressed to, without its port.
 *
 * Handles `localhost:3000`, `[::1]:3000`, a bare `::1`, and a plain
 * hostname. A bare IPv6 literal has several colons and no port; a
 * host:port pair has exactly one.
 */
export function hostOf(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return (end === -1 ? value.slice(1) : value.slice(1, end)).toLowerCase();
  }

  const colon = value.indexOf(":");
  const host = colon !== -1 && value.indexOf(":", colon + 1) === -1 ? value.slice(0, colon) : value;
  return host.toLowerCase();
}

export function isLoopbackHost(raw: string | null | undefined): boolean {
  return LOOPBACK_HOSTS.has(hostOf(raw));
}

/**
 * Pick the mode.
 *
 * An explicit `NUTRIPLAN_GATE` always wins; an unknown value falls back to
 * the strictest mode rather than to `off`. With no setting, a configured
 * allowlist or token implies the mode it belongs to, so a deployment only
 * has to set the thing it actually needs. Everything else stays `local`:
 * the app is reachable on the machine and nowhere else.
 */
export function resolveGateMode(env: Record<string, string | undefined> = process.env): GateMode {
  const explicit = env.NUTRIPLAN_GATE?.trim().toLowerCase();
  if (explicit === "off" || explicit === "token" || explicit === "hosts" || explicit === "local") {
    return explicit;
  }
  if (explicit) return "local";
  if (env.NUTRIPLAN_ALLOWED_HOSTS?.trim()) return "hosts";
  if (env.NUTRIPLAN_TOKEN?.trim()) return "token";
  return "local";
}

/**
 * Parse `NUTRIPLAN_ALLOWED_HOSTS` (`a.example.com,*.example.com:8443`).
 * A leading `*.` matches any subdomain, never the bare domain — the same
 * convention Next uses for `allowedOrigins`.
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Port is irrelevant to which site this is; the hostname is the identity. */
function patternHost(pattern: string): string {
  return pattern.startsWith("*.") ? `*.${hostOf(pattern.slice(2))}` : hostOf(pattern);
}

export function hostMatches(host: string, patterns: string[]): boolean {
  const target = hostOf(host);
  if (!target) return false;
  for (const pattern of patterns) {
    const normalized = patternHost(pattern);
    if (!normalized) continue;
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1); // ".example.com"
      // Require at least one label before the suffix: `*.example.com`
      // must not match `example.com` itself.
      if (target.length > suffix.length && target.endsWith(suffix)) return true;
      continue;
    }
    if (normalized === target) return true;
  }
  return false;
}

/**
 * Compare a supplied token with the configured one.
 *
 * Length-then-value with no early exit on content keeps it from being an
 * obvious timing oracle. The token is a shared secret over the network, so
 * this is the one comparison in the app that should not short-circuit.
 */
export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface GateInput {
  mode: GateMode;
  /** The `Host` header: the authority the client actually addressed. */
  host: string | null | undefined;
  /** `X-Forwarded-Host`, only consulted when `trustProxy` is on. */
  forwardedHost?: string | null;
  /**
   * `NUTRIPLAN_TRUST_PROXY=1`. Forwarded headers are client-writable, so
   * they are ignored unless the operator states a proxy rewrites them.
   */
  trustProxy: boolean;
  providedToken?: string | null;
  expectedToken?: string | undefined;
  allowedHosts: string[];
}

export interface GateDecision {
  allow: boolean;
  /** Why, for tests and the one-time startup log. */
  via: "off" | "loopback" | "token" | "host" | "blocked";
}

/**
 * The decision itself.
 *
 * `effectiveHost` prefers `X-Forwarded-Host` only under `trustProxy`.
 * Otherwise `Host` is authoritative.
 *
 * A loopback `Host` is only trusted in `local` mode. In `hosts` and `token`
 * mode it is a *claim*, not a fact: a reverse proxy that forwards its
 * upstream (`127.0.0.1:3000`) would otherwise turn the gate into a no-op for
 * every request on the internet. That is the failure mode this function used
 * to have.
 */
export function decideGate(input: GateInput): GateDecision {
  if (input.mode === "off") return { allow: true, via: "off" };

  const effectiveHost =
    input.trustProxy && input.forwardedHost ? input.forwardedHost : input.host;

  if (input.mode === "local") {
    return isLoopbackHost(effectiveHost)
      ? { allow: true, via: "loopback" }
      : { allow: false, via: "blocked" };
  }

  if (input.mode === "token") {
    return tokenMatches(input.providedToken, input.expectedToken)
      ? { allow: true, via: "token" }
      : { allow: false, via: "blocked" };
  }

  // `hosts`: the allowlist is the only way in, loopback included.
  return hostMatches(effectiveHost ?? "", input.allowedHosts)
    ? { allow: true, via: "host" }
    : { allow: false, via: "blocked" };
}

export function trustProxyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.NUTRIPLAN_TRUST_PROXY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** The small slice of a request this check needs, so it stays testable. */
export interface OriginCheckRequest {
  method: string;
  headers: { get(name: string): string | null };
}

/**
 * Reject a state-changing request that a browser reports as cross-origin.
 *
 * Next's own action check rejects a *wrong* `Origin`, but a missing `Origin`
 * passes. This runs before it and is deliberately stricter:
 *
 *   - `Sec-Fetch-Site` must be absent or `same-origin`. `none` is a
 *     user-typed navigation, never a legitimate server-action POST;
 *     `same-site` and `cross-site` are rejected.
 *   - When `Origin` is present its authority must equal the request's, or
 *     match a configured `NUTRIPLAN_ALLOWED_ORIGINS` authority (a public
 *     origin fronting the app through a proxy). A non-default port is
 *     significant in both branches; `:80`/`:443` is normalised away.
 *
 * A non-browser client sends neither header and is still subject to the gate
 * and token rules.
 */
export function isCrossSiteMutation(
  request: OriginCheckRequest,
  effectiveHost: string,
  allowedOrigins: string[] = [],
): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originHost = authority(new URL(origin).host);
    if (originHost === authority(effectiveHost)) return false;
    return !originAllowed(originHost, allowedOrigins);
  } catch {
    return true;
  }
}

/**
 * Match an `Origin` authority against `NUTRIPLAN_ALLOWED_ORIGINS`.
 *
 * Unlike the gate's host allowlist, the port is significant here: a service
 * on another local port is a different origin, which is exactly what this
 * check exists to stop. Entries are `host[:port]`; a leading `*.` matches
 * subdomains (never the bare domain). Default ports are normalised away, so
 * `app.example.com` also matches `https://app.example.com:443`.
 */
function originAllowed(originHost: string, patterns: string[]): boolean {
  const target = authority(originHost);
  if (!target) return false;
  for (const raw of patterns) {
    const pattern = authority(raw);
    if (!pattern) continue;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      if (target.length > suffix.length && target.endsWith(suffix)) return true;
      continue;
    }
    if (pattern === target) return true;
  }
  return false;
}

/** Lowercase, trim, and drop a default HTTP(S) port. */
function authority(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, "");
}
