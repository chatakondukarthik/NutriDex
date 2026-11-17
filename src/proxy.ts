/**
 * Request gate + per-request CSP (Next 16's replacement for middleware.ts).
 *
 * ## Why a gate at all
 *
 * Every server action in `src/app/actions.ts` runs with no session, no user
 * and no ownership check — by design, this is a single-user app. Next's own
 * action origin check only rejects cross-site requests; a request with no
 * `Origin` header is allowed through. So anyone who can reach the port can
 * read, rewrite or delete every recipe and food, and can point the AI
 * `baseUrl` at a host of their choosing to capture the stored key.
 *
 * The dev server binds `*:3000` (the whole LAN), which makes that a live
 * exposure rather than a theoretical one. The gate keeps the app on the
 * machine by default and gives a deployment an explicit way to open it.
 *
 * ## Modes (`NUTRIPLAN_GATE`, or inferred — see `resolveGateMode`)
 *
 *   local  (default) — only requests addressed to a loopback host.
 *   hosts            — only hosts in `NUTRIPLAN_ALLOWED_HOSTS`; loopback
 *                      is not implicitly trusted, so a proxy that rewrites
 *                      `Host` to its upstream cannot bypass the allowlist.
 *   token            — only a valid `nutriplan_token` (header or cookie)
 *                      matching `NUTRIPLAN_TOKEN`. The query-string form is
 *                      rejected because URLs leak into history and logs.
 *   off              — no gate.
 *
 * Fail-closed: a misconfigured deployment is unreachable, not open.
 *
 * ## Trust boundary
 *
 * `Host` is the authority the client addressed. `X-Forwarded-Host` is only
 * consulted with `NUTRIPLAN_TRUST_PROXY=1`, because forwarded headers are
 * client-writable: trusting them by default would let anyone claim
 * `X-Forwarded-Host: localhost` and walk in.
 *
 * Even so, `Host` is a header. A caller who forges `Host: localhost` gets
 * through `local` mode. This is a safety net, not authentication — put a
 * real reverse proxy (TLS, basic auth, VPN, or `token` mode) in front of a
 * public deployment.
 *
 * ## CSP
 *
 * Production uses a per-request nonce for scripts, which lets `script-src`
 * drop `'unsafe-inline'`; Next injects the nonce into its own script tags
 * for dynamically rendered pages (all routes here are dynamic). Development
 * keeps the looser policy because React Refresh needs `'unsafe-eval'` and
 * the dev experience should not differ from what it was.
 *
 * `style-src` keeps `'unsafe-inline'`: a nonce does not cover `style="…"`
 * attributes, and React Flow sets node positions that way.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  decideGate,
  parseAllowedHosts,
  resolveGateMode,
  trustProxyEnabled,
} from "@/lib/security/gate";

const isDev = process.env.NODE_ENV !== "production";

/** One log line per process: an operator should be able to see the mode. */
let announced = false;
function announceMode(mode: string): void {
  if (announced) return;
  announced = true;
  const trustProxy = trustProxyEnabled();
  // Never logs the token, only the shape of the configuration.
  console.info(`[gate] mode=${mode} trustProxy=${trustProxy ? "on" : "off"}`);
  if (!trustProxy && mode !== "local" && mode !== "off") {
    // A reverse proxy that rewrites `Host` to a loopback upstream makes every
    // request look local, which silently bypasses `hosts` and `token` modes.
    console.warn(
      "[gate] Host is authoritative. If a proxy rewrites Host to a loopback " +
        "address, preserve the public Host or set NUTRIPLAN_TRUST_PROXY=1 " +
        "with an overwritten X-Forwarded-Host.",
    );
  }
}

function buildCsp(nonce?: string): string {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`;

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Nonce does not apply to style attributes (React Flow positions).
    "style-src 'self' 'unsafe-inline'",
    // `data:` for FileReader previews in the food editor, `blob:` for downloads.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Dev HMR opens a websocket to the dev server; production is same-origin.
    `connect-src 'self'${isDev ? " ws://localhost:* ws://127.0.0.1:* ws://[::1]:*" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Only meaningful over TLS; harmless behind a TLS-terminating proxy.
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function blockedResponse(): NextResponse {
  // Deliberately terse: this goes to whoever is probing the port, so it
  // names no routes, versions or configuration.
  return new NextResponse(
    "NutriPlan is bound to this machine. Set NUTRIPLAN_GATE=hosts with " +
      "NUTRIPLAN_ALLOWED_HOSTS, or NUTRIPLAN_GATE=token with NUTRIPLAN_TOKEN, " +
      "to allow remote access.",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Reject a state-changing request that did not come from this origin.
 *
 * Next's server-action origin check is the primary CSRF defence, but it
 * allows a request with **no** `Origin` header. Any website in the user's
 * browser can still make it issue a cross-site POST to `127.0.0.1`, and the
 * browser always attaches `Origin` or `Sec-Fetch-Site`. Checking both here
 * closes that gap for every mutation, including any future Route Handler
 * that Next would not cover.
 *
 * A non-browser client (curl, a test) sends neither header and is still
 * subject to the gate and token rules.
 */
function isCrossSiteMutation(request: NextRequest, effectiveHost: string): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    // Compare the full authority, including the port: `http://host:1234` and
    // `http://host:5678` are different origins, and stripping the port here
    // would let a service on another local port drive the app.
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(effectiveHost ?? "").trim().toLowerCase();
    return originHost !== requestHost;
  } catch {
    return true;
  }
}

export function proxy(request: NextRequest) {
  // Health checks come from a load balancer or orchestrator that is not a
  // browser and has no session. The route returns only `{ ok }`.
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const mode = resolveGateMode();
  announceMode(mode);

  const trustProxy = trustProxyEnabled();
  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const effectiveHost = trustProxy && forwardedHost ? forwardedHost : host;

  const providedToken =
    request.headers.get("nutriplan_token") ??
    request.cookies.get("nutriplan_token")?.value;

  const decision = decideGate({
    mode,
    host,
    forwardedHost,
    trustProxy,
    providedToken,
    expectedToken: process.env.NUTRIPLAN_TOKEN,
    allowedHosts: parseAllowedHosts(process.env.NUTRIPLAN_ALLOWED_HOSTS),
  });

  if (!decision.allow) return blockedResponse();
  if (isCrossSiteMutation(request, effectiveHost ?? "")) return blockedResponse();

  const headers = new Headers(request.headers);
  if (!trustProxy) {
    // Forwarded headers are client-writable, and Next's server-action origin
    // check trusts `X-Forwarded-Host`. A caller could satisfy that check by
    // sending one. Strip them unless the operator states a proxy rewrites
    // them; `Host` is then the only authority.
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");
    headers.delete("x-forwarded-for");
  }

  if (isDev) {
    // Static policy from next.config.ts also applies; this keeps dev
    // identical to the previous behaviour while prod gets a nonce.
    return NextResponse.next({ request: { headers } });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  // Next reads the nonce from the request-side CSP header and stamps it onto
  // the script tags it renders, so it must be on the request headers too.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Every route is gated, including action POSTs (which arrive on page paths)
 * and dev assets — a remote client should not be able to load the bundle
 * either. `/api/health` is exempted inside the handler.
 */
export const config = {
  matcher: ["/:path*"],
};
