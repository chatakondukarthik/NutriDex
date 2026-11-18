import { archiveFileName, buildArchive } from "@/lib/archive/export";
import { ARCHIVE_SCOPES } from "@/lib/archive/manifest";
import type { ArchiveScope } from "@/lib/archive/registry";
import { getPerson } from "@/lib/db/people";
import { getActivePerson } from "@/lib/person-server";

/**
 * Download an archive.
 *
 * A GET is safe here: it reads the local database and returns it to the
 * browser that asked. A cross-origin page cannot read the response body
 * (no CORS headers), and the gate has already decided whether this request
 * may reach the app at all. Nothing is written, so there is no CSRF surface
 * — `isCrossSiteMutation` only guards state changes.
 *
 *   scope=household  every person and the shared library (default)
 *   scope=person     one person plus the shared library
 *   scope=shared     the shared library only
 *
 * A person id from the query string is only a selector among household
 * members; it is never treated as a credential. With no `person`, the active
 * person is exported.
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

  const requestedScope = url.searchParams.get("scope") ?? "household";
  if (!ARCHIVE_SCOPES.includes(requestedScope as ArchiveScope)) {
    return new Response("Unknown archive scope.", { status: 400 });
  }
  const scope = requestedScope as ArchiveScope;

  let personId: string | null = null;
  let personName: string | undefined;
  if (scope === "person") {
    const requestedPerson = url.searchParams.get("person");
    if (requestedPerson) {
      const person = getPerson(requestedPerson);
      if (!person) return new Response("That person no longer exists.", { status: 404 });
      personId = person.id;
      personName = person.displayName;
    } else {
      const active = await getActivePerson();
      personId = active.id;
      personName = active.displayName;
    }
  }

  const { buffer } = buildArchive({ scope, personId, includeAiCalls, includeSnapshot });
  const fileName = archiveFileName(new Date(), scope, personName);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(buffer.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
