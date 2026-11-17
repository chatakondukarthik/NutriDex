import { ImportError, importArchive, type ImportMode } from "@/lib/archive/import";
import { ZipError } from "@/lib/archive/zip";
import { readBodyWithLimit } from "@/lib/http/body";

/**
 * Apply an archive.
 *
 * A POST, so the cross-site mutation check in `src/proxy.ts` covers it. The
 * body is bounded while it is read, not after: `content-length` is only a
 * fast path, because a chunked upload can omit it entirely.
 *
 * `dryRun=1` runs the identical code path and rolls back, so "check this
 * file" cannot disagree with "apply this file".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A personal archive is a few MB; 64 MB is already generous. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const NO_STORE = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function failure(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return failure("That file is larger than the 64 MB import limit.", 413);
  }

  const body = await readBodyWithLimit(request, MAX_UPLOAD_BYTES);
  if (body === null) {
    return failure("That file is larger than the 64 MB import limit.", 413);
  }
  if (body.length === 0) return failure("Choose an archive to import.", 400);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return failure("Send the archive as multipart form data.", 400);
  }

  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return failure("Send the archive as multipart form data.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return failure("Choose an archive to import.", 400);
  if (file.size === 0) return failure("That file is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return failure("That file is larger than the 64 MB import limit.", 413);
  }

  const mode: ImportMode = form.get("mode") === "replace" ? "replace" : "merge";
  const dryRun = form.get("dryRun") === "1";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = importArchive(buffer, { mode, dryRun });
    return Response.json(report, { headers: NO_STORE });
  } catch (error) {
    // Only our own validation messages reach the client. Anything else is a
    // bug, and a stack trace or SQL text is not a useful import error.
    if (error instanceof ImportError || error instanceof ZipError) {
      return failure(error.message, 400);
    }
    console.error("[import] unexpected failure", error);
    return failure("The archive could not be imported. Nothing was changed.", 500);
  }
}
