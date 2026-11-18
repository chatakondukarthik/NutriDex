import Link from "next/link";

/**
 * The colophon on every page: the ledger sign-off.
 * Hairline, a small thali glyph, the house rule. Deliberately quiet —
 * a printer's mark, not a footer CTA.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 bg-canvas/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
        <p className="flex items-center gap-2 text-[9px] font-ledger uppercase tracking-[0.22em] text-faint">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="text-accent">
            <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 2.4" opacity="0.8" />
          </svg>
          NutriPlan · the household kitchen ledger
        </p>
        <nav aria-label="Foot" className="flex items-center gap-4 text-[9px] font-ledger uppercase tracking-[0.18em] text-faint">
          <Link href="/about" className="transition-colors hover:text-ink">About</Link>
          <Link href="/glossary" className="transition-colors hover:text-ink">Glossary</Link>
          <Link href="/settings" className="transition-colors hover:text-ink">Settings</Link>
        </nav>
      </div>
    </footer>
  );
}
