import type { NextConfig } from "next";

/**
 * Security headers, deployment shape, and server-action limits.
 *
 * The app renders exclusively through React text nodes (no
 * `dangerouslySetInnerHTML` in `src/`), so headers here are
 * defence-in-depth rather than the only thing between stored data and
 * script execution.
 *
 * The CSP is set in two places on purpose:
 *   - production: `src/proxy.ts`, because it needs a per-request nonce;
 *   - development: below, a looser static policy (React Refresh needs
 *     `'unsafe-eval'`), so `npm run dev` is unchanged.
 * A production build sees `NODE_ENV=production` here and emits no CSP, so
 * the two never both apply.
 */
const isDev = process.env.NODE_ENV !== "production";

const devCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws://localhost:* ws://127.0.0.1:*`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  ...(isDev ? [{ key: "Content-Security-Policy", value: devCsp }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Only honoured over HTTPS. `includeSubDomains` is deliberately omitted:
  // a subdomain deployment should not have its siblings pinned by accident.
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
];

/**
 * Extra origins allowed to invoke server actions, for deployments whose
 * reverse proxy forwards its own host instead of the public one.
 *
 * These are host patterns, not URLs. `*` is rejected: Next's action origin
 * check is the CSRF defence, and a wildcard would switch it off.
 */
function allowedOriginsFromEnv(raw: string | undefined): string[] {
  const entries = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry === "*" || entry.includes("://") || entry.includes("/")) {
      throw new Error(
        `NUTRIPLAN_ALLOWED_ORIGINS: "${entry}" is not a host pattern. ` +
          `Use app.example.com or app.example.com:8443 (a leading *. is allowed).`,
      );
    }
  }
  return entries;
}

const allowedOrigins = allowedOriginsFromEnv(process.env.NUTRIPLAN_ALLOWED_ORIGINS);
const allowedDevOrigins = String(process.env.NUTRIPLAN_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Emit `.next/standalone` with only the files a deployment needs, so the
  // container image does not ship dev dependencies.
  output: "standalone",
  // Do not advertise the framework in every response.
  poweredByHeader: false,

  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  /**
   * Never trace runtime state into the build.
   *
   * The database, `secrets.json` and `ai-config.json` are resolved from
   * `process.cwd()` at runtime. Next's static tracer sees that path and
   * copies the whole `data/` directory into `.next/standalone` — which would
   * bake a developer's API keys into an artifact that is then shipped or
   * archived. The app creates the directory on boot, so nothing there is
   * needed at build time.
   *
   * `scripts/check-standalone.mjs` runs after the build and fails if this
   * ever stops being true.
   */
  outputFileTracingExcludes: {
    "/*": ["data/**", ".env", ".env.*", "*.db", "*.db-*", "*.sqlite", "*.sqlite-*"],
  },

  experimental: {
    serverActions: {
      // The default is 1 MB, which the food editor already exceeds: a 5 MB
      // image base64-encodes to ~6.7 MB. 16 MB covers the spec's image
      // budget (10 images, capped to 12 MB total in the action) with room
      // for multipart overhead — and still bounds what one request can make
      // the server buffer. A reverse proxy in front needs a matching
      // client_max_body_size.
      bodySizeLimit: "16mb",
      ...(allowedOrigins.length ? { allowedOrigins } : {}),
    },
  },
};

export default nextConfig;
