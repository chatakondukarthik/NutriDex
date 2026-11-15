"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The route-level error boundary.
 *
 * Server components can fail on a bad read — a half-migrated database, a
 * stale dev-server handle. The user gets a way back instead of a stack
 * trace, and the digest gives us something to correlate in the logs.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-5 py-10">
      <div className="w-full rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-warn-ink">
          Something went wrong
        </p>
        <h1 className="mt-1.5 text-lg font-semibold">This page could not be loaded</h1>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          The data behind it did not come back in a shape the page could use. Trying again often
          fixes a transient read; if it keeps failing, restart the dev server.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition hover:bg-accent-strong"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-xs font-medium text-ink/70 transition hover:bg-ink/5"
          >
            Back to the diary
          </Link>
        </div>

        {error.digest && (
          <p className="mt-4 text-[10px] text-faint">Reference: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
