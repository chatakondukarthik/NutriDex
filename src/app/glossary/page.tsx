import Link from "next/link";
import { GLOSSARY } from "@/lib/glossary";
import { PageHeader } from "@/components/page-header";
import { Spotlight } from "@/components/spotlight";
import { Rise } from "@/components/motion/reveal";

export const dynamic = "force-dynamic";

export default function GlossaryPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <PageHeader
          title="Nutrient glossary"
          kicker="18 nutrients · plain language"
          lead="Plain-language notes on the 18 nutrients NutriPlan tracks. No nutrition degree required."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {GLOSSARY.map((entry, index) => (
          <Spotlight
            as="article"
            key={entry.code}
            className="rounded-xl border border-line bg-surface p-4 transition-[box-shadow,border-color] duration-200 ease-out hover:border-line-strong hover:shadow-plate"
            index={index}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-sm font-semibold tracking-tight text-ink">{entry.name}</h2>
              <span className="text-[11px] text-muted">{entry.unit}</span>
            </div>
            <p className="mt-1 text-xs text-ink/80">{entry.plain}</p>
            <p className="mt-2 text-xs text-muted">{entry.why}</p>
            <p className="mt-2 text-[11px] font-medium text-accent">{entry.dailyOrWeekly}</p>
          </Spotlight>
        ))}
      </div>

      <Rise delay={0.45}>
        <p className="mt-6 text-xs text-muted">
          See also <Link href="/about" className="underline underline-offset-2 hover:text-ink">how targets are calculated</Link>.
        </p>
      </Rise>
    </main>
  );
}
