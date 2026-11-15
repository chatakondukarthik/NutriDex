"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SettingsIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
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

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/80 backdrop-blur-xl">
      {/*
        One row on wide screens. On phones the nav drops to its own full-width
        row: five links plus two icon buttons do not fit beside the wordmark,
        and letting the row scroll hid "About" behind an invisible scrollbar.
      */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1.5 gap-y-2 px-5 py-2.5 sm:py-3">
        <Link href="/" className="mr-auto flex shrink-0 items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-semibold text-accent-ink shadow-card">
            N
          </span>
          <span className="text-sm font-semibold leading-tight">NutriPlan</span>
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
                  "shrink-0 rounded-lg px-2 py-2 text-xs font-medium transition sm:px-3 sm:py-1.5",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-ink/5 hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <ThemeToggle />

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition",
            pathname.startsWith("/settings")
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-ink/5 hover:text-ink",
          )}
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
