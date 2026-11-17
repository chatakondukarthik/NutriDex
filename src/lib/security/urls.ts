/**
 * Outbound URL validation (SSRF / credential-exfiltration guard).
 *
 * The AI layer posts a *stored API key* to a user-supplied `baseUrl`, and
 * server actions let anyone who can reach the port supply one. Without a
 * check here that is a straight credential exfiltration and SSRF primitive:
 * point baseUrl at `https://attacker.test/` and the key arrives as a
 * Bearer header, or at `http://169.254.169.254/` for cloud metadata.
 *
 * Policy (docs/spec/BYO_LLM.md §11):
 *   - `https:` only — never plaintext, never a scheme we do not expect.
 *   - No embedded credentials (`user:pass@host`).
 *   - No private, loopback, link-local, multicast or reserved ranges.
 *   - No link-local *ever*, even with local-model opt-in (that is exactly
 *     where cloud instance-metadata endpoints live).
 *
 * Local model servers (Ollama, LM Studio, llama.cpp on :11434/:1234) are a
 * legitimate use of the openai-compatible provider, so loopback/private is
 * permitted only behind an explicit env opt-in the caller cannot set.
 */

import { lookup } from "node:dns/promises";

const OPT_IN_ENV = "NUTRIPLAN_ALLOW_PRIVATE_AI_URLS";

/** Allowed only with the env opt-in: http://localhost:11434 and friends. */
const LOCALHOST_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

export interface UrlVerdict {
  ok: boolean;
  /** Normalised URL (trailing slash trimmed) when ok. */
  url?: string;
  /** User-facing reason when not ok. */
  reason?: string;
}

/** Link-local, metadata and documentation ranges: never allowed, opt-in or not. */
function isNeverAllowed(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIpv4(bare)) {
    const [a, b, c] = bare.split(".").map(Number);
    if (a === 169 && b === 254) return true; // 169.254.0.0/16, incl. 169.254.169.254
    // TEST-NET-1/2/3: documentation ranges. Nothing real lives there, so a
    // "destination" in them is always a mistake or an attack.
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }

  const v6 = expandIpv6(bare);
  if (!v6) return false;

  // fe80::/10 link-local.
  if ((v6[0] & 0xffc0) === 0xfe80) return true;
  // 2001:db8::/32 documentation.
  if (v6[0] === 0x2001 && v6[1] === 0x0db8) return true;

  // A v6 literal can embed an IPv4 address; judge the embedded address, or
  // an attacker simply writes `[::ffff:169.254.169.254]` to bypass the
  // plain-IPv4 check above.
  const embedded = embeddedIpv4(v6);
  if (embedded) return isNeverAllowed(embedded);

  // NAT64 local-use prefix (RFC 8215): never a public destination.
  if (v6[0] === 0x0064 && v6[1] === 0xff9b && v6[2] === 0x0001) return true;

  return false;
}

/**
 * The IPv4 address carried inside a v6 literal, or null.
 *
 * Handles IPv4-mapped (`::ffff:a.b.c.d`) and the well-known NAT64 prefix
 * (`64:ff9b::/96`, RFC 6052). Both reach an IPv4 destination on the wire,
 * so a range check on the v6 groups alone would miss the target.
 */
function embeddedIpv4(v6: number[]): string | null {
  const tail = () => `${v6[6] >> 8}.${v6[6] & 0xff}.${v6[7] >> 8}.${v6[7] & 0xff}`;

  // ::ffff:0:0/96
  if (v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff) return tail();

  // 64:ff9b::/96
  if (
    v6[0] === 0x0064 &&
    v6[1] === 0xff9b &&
    v6[2] === 0 &&
    v6[3] === 0 &&
    v6[4] === 0 &&
    v6[5] === 0
  ) {
    return tail();
  }

  return null;
}

/** Private / loopback / reserved / multicast — blocked unless opted in. */
function isPrivateOrLocal(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (LOCALHOST_NAMES.has(bare.toLowerCase())) return true;

  if (isIpv4(bare)) {
    const [a, b, c] = bare.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  // Not an IP literal at all: a DNS name. Its addresses are checked after
  // resolution, so this is *not* private — treating a normal hostname as
  // unsafe here would block every legitimate custom endpoint.
  if (!bare.includes(":")) {
    // Dotted-quad shaped but unparseable (`999.1.1.1`, `1.2.3`) will never
    // resolve to anything we can verify, so refuse it rather than guess.
    return /^\d+(\.\d+){1,3}$/.test(bare);
  }

  const v6 = expandIpv6(bare);
  if (!v6) return true; // unparseable IPv6 literal: fail closed
  // Range checks run on the first 16-bit group — masking a wider composite
  // shifts the bits and matches ranges that do not exist.
  if ((v6[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((v6[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((v6[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // IPv4-mapped and NAT64 literals reach an IPv4 destination on the wire,
  // so judge the embedded address rather than the v6 groups.
  const embedded = embeddedIpv4(v6);
  if (embedded) return isNeverAllowed(embedded) || isPrivateOrLocal(embedded);
  // `::` and `::1`: every group zero except the trailing loopback.
  if (v6[0] === 0 && v6.slice(0, 7).every((x) => x === 0)) return true;
  return false;
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p);
}

/** Parse to 8 groups of 16 bits, or null. Handles :: compression. */
function expandIpv6(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(host) || !host.includes(":")) return null;
  const [head, tail] = host.split("::", 3).length > 2 ? ["", ""] : host.split("::", 2);
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const explicit = headGroups.length + tailGroups.length;
  const isIpv4Tail = tailGroups.length > 0 && tailGroups[tailGroups.length - 1].includes(".");
  let groups: string[];
  if (host.includes("::")) {
    if (explicit > 7 && !isIpv4Tail) return null;
    const fill = new Array(isIpv4Tail ? 7 - explicit : 8 - explicit).fill("0");
    groups = [...headGroups, ...fill, ...tailGroups];
  } else {
    groups = headGroups;
  }
  const out: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.includes(".")) {
      if (i !== groups.length - 1 || !isIpv4(g)) return null;
      const [a, b, c, d] = g.split(".").map(Number);
      out.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out.length === 8 ? out : null;
}

function localOptIn(): boolean {
  const raw = process.env[OPT_IN_ENV];
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Cheap synchronous checks: scheme, credentials, literal-IP ranges. */
export function checkUrlSyntax(raw: string): UrlVerdict {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "A base URL is required." };
  }
  if (raw.length > 2048) {
    return { ok: false, reason: "That URL is too long." };
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only https:// URLs are supported." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username/password from the URL." };
  }
  // Checked before the plain-http rule: the metadata endpoint is the
  // reason this file exists, and it should always say so.
  if (isNeverAllowed(url.hostname)) {
    return { ok: false, reason: "Link-local addresses are not allowed." };
  }
  if (url.protocol === "http:" && !localOptIn()) {
    return { ok: false, reason: "Only https:// URLs are supported (plain http would send your key unencrypted)." };
  }
  if (isPrivateOrLocal(url.hostname) && !localOptIn()) {
    return {
      ok: false,
      reason: `Local or private addresses are blocked. Set ${OPT_IN_ENV}=1 to allow a local model server.`,
    };
  }

  return { ok: true, url: url.toString().replace(/\/$/, "") };
}

/**
 * Full validation including DNS resolution, so a public hostname that
 * resolves into a private range (DNS rebinding) is rejected too.
 *
 * Results are cached briefly — adapters call this on every request and a
 * lookup per call would otherwise add latency and a failure mode when
 * resolution hiccups.
 */
const dnsCache = new Map<string, { ok: boolean; until: number }>();
const DNS_TTL_MS = 5 * 60 * 1000;

export async function validateOutboundUrl(raw: string): Promise<UrlVerdict> {
  const syntactic = checkUrlSyntax(raw);
  if (!syntactic.ok) return syntactic;

  const url = new URL(syntactic.url!);
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Literal IPs were checked above; nothing further to resolve.
  if (isIpv4(host) || host.includes(":")) return syntactic;

  const cached = dnsCache.get(host);
  if (cached && cached.until > Date.now()) {
    return cached.ok
      ? syntactic
      : { ok: false, reason: "That host resolves to a local or private address." };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    dnsCache.set(host, { ok: false, until: Date.now() + 30_000 });
    return { ok: false, reason: "That host name could not be resolved." };
  }

  const bad = addresses.find(
    (a) => isNeverAllowed(a.address) || (isPrivateOrLocal(a.address) && !localOptIn()),
  );
  dnsCache.set(host, { ok: !bad, until: Date.now() + DNS_TTL_MS });
  if (bad) {
    return { ok: false, reason: "That host resolves to a local or private address." };
  }
  return syntactic;
}

/** Throwing form for use at the top of every outbound adapter call. */
export async function assertOutboundUrl(raw: string): Promise<string> {
  const verdict = await validateOutboundUrl(raw);
  if (!verdict.ok) throw new Error(verdict.reason ?? "That URL is not allowed.");
  return verdict.url!;
}

/** Test seam: drop the DNS cache between cases. */
export function clearUrlCache(): void {
  dnsCache.clear();
}
