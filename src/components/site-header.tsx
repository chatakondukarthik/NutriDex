"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SettingsIcon } from "@/components/icons";
import { PersonSwitcher } from "@/components/person-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMotionEnabled } from "@/components/theme-provider";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Diary" },
  { href: "/plan", label: "Plan" },
  { href: "/recipes", label: "Recipes" },
  { href: "/foods", label: "Foods" },
  { href: "/profile", label: "Profile" },
  { href: "/about", label: "About" },
  { href: "/glossary", label: "Glossary" },
];

export function SiteHeader({
  people,
  activePersonId,
}: {
  people: Array<{ id: string; displayName: string }>;
  activePersonId: string;
}) {
  const pathname = usePathname();
  const motionEnabled = useMotionEnabled();

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur-xl">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-5 py-2.5 sm:py-3">
        <Link href="/" className="group mr-auto flex shrink-0 items-center gap-2.5" aria-label="NutriPlan home">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-xl border border-accent-strong/40 bg-accent font-display text-lg font-black text-accent-ink shadow-card transition-transform duration-200 group-hover:-rotate-3"
          >
            N
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[17px] font-bold tracking-tight text-ink">
              NutriPlan
            </span>
            <span className="mt-1 hidden font-ledger text-[9px] uppercase tracking-[0.18em] text-faint sm:block">
              The kitchen ledger
            </span>
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="order-last flex w-full items-center justify-between gap-0.5 overflow-x-auto [scrollbar-width:none] sm:order-none sm:w-auto sm:justify-start [&::-webkit-scrollbar]:hidden"
        >
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors sm:px-3 sm:py-1.5",
                  active ? "text-accent-ink" : "text-muted hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active-plate"
                    transition={
                      motionEnabled
                        ? { type: "spring", stiffness: 420, damping: 32 }
                        : { duration: 0 }
                    }
                    className="absolute inset-0 -z-10 rounded-lg border border-accent-strong/40 bg-accent shadow-sm"
                  />
                )}
                <span className="relative">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <PersonSwitcher people={people} activePersonId={activePersonId} />

        <ThemeToggle />

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition",
            pathname.startsWith("/settings")
              ? "bg-accent/15 text-accent"
              : "text-muted hover:bg-ink/5 hover:text-ink",
          )}
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
