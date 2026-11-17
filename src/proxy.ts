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
 *   hosts            — loopback plus `NUTRIPLAN_ALLOWED_HOSTS`; the mode
 *                      for a deployment behind a reverse proxy.
 *   token            — loopback plus `nutriplan_token` (header, cookie or
 *                      query) matching `NUTRIPLAN_TOKEN`.
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

export function proxy(request: NextRequest) {
  // Health checks come from a load balancer or orchestrator that is not a
  // browser and has no session. The route returns only `{ ok }`.
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const mode = resolveGateMode();
  announceMode(mode);

  const providedToken =
    request.headers.get("nutriplan_token") ??
    request.cookies.get("nutriplan_token")?.value ??
    request.nextUrl.searchParams.get("nutriplan_token");

  const decision = decideGate({
    mode,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    trustProxy: trustProxyEnabled(),
    providedToken,
    expectedToken: process.env.NUTRIPLAN_TOKEN,
    allowedHosts: parseAllowedHosts(process.env.NUTRIPLAN_ALLOWED_HOSTS),
  });

  if (!decision.allow) return blockedResponse();

  const headers = new Headers(request.headers);
  if (isDev) {
    // Static policy from next.config.ts also applies; this keeps dev
    // identical to the previous behaviour while prod gets a nonce.
    return NextResponse.next();
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
