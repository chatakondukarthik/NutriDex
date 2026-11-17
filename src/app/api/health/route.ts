import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe for a load balancer or container orchestrator.
 *
 * Deliberately says nothing else: no version, no paths, no error text. The
 * only signal is "the process can open its database", which is what a
 * probe should act on. The proxy exempts this path from the gate so a
 * probe from another host works; that is safe precisely because the
 * response carries no data.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET() {
  try {
    const { db } = await import("@/lib/db/client");
    db.prepare("SELECT 1").get();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    // The reason stays in the server log; the probe only needs the status.
    console.error("[health] database check failed");
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
