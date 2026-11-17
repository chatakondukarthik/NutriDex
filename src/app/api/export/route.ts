import { archiveFileName, buildArchive } from "@/lib/archive/export";

/**
 * Download a complete archive.
 *
 * A GET is safe here: it reads the local database and returns it to the
 * browser that asked. A cross-origin page cannot read the response body
 * (no CORS headers), and the gate has already decided whether this request
 * may reach the app at all. Nothing is written, so there is no CSRF surface
 * — `isCrossSiteMutation` only guards state changes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // `ai=1` opts into the AI log (off by default); `snapshot=0` opts out of
  // the full SQLite copy (on by default). Both are extras around the same
  // user-content core.
  const includeAiCalls = url.searchParams.get("ai") === "1";
  const includeSnapshot = url.searchParams.get("snapshot") !== "0";

  const { buffer } = buildArchive({ includeAiCalls, includeSnapshot });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${archiveFileName()}"`,
      "content-length": String(buffer.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
