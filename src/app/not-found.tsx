import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-5 py-10">
      <div className="w-full rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">404</p>
        <h1 className="font-display mt-1.5 text-lg font-bold tracking-tight">That page does not exist</h1>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          The link may be old, or the thing it pointed at was removed. The diary and the plan are
          both still here.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition hover:bg-accent-strong"
          >
            Go to the diary
          </Link>
          <Link
            href="/plan"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-xs font-medium text-ink/70 transition hover:bg-ink/5"
          >
            Open the plan
          </Link>
        </div>
      </div>
    </main>
  );
}
