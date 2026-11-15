import Link from "next/link";
import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

export default function GlossaryPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Nutrient glossary</h1>
        <p className="mt-1 text-xs text-muted">
          Plain-language notes on the 18 nutrients NutriPlan tracks. No nutrition degree required.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {GLOSSARY.map((entry) => (
          <article key={entry.code} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold">{entry.name}</h2>
              <span className="text-[11px] text-muted">{entry.unit}</span>
            </div>
            <p className="mt-1 text-xs text-ink/80">{entry.plain}</p>
            <p className="mt-2 text-xs text-muted">{entry.why}</p>
            <p className="mt-2 text-[11px] font-medium text-accent">{entry.dailyOrWeekly}</p>
          </article>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted">
        See also <Link href="/about" className="underline underline-offset-2 hover:text-ink">how targets are calculated</Link>.
      </p>
    </main>
  );
}
