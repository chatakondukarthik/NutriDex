"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { switchPersonAction } from "@/app/actions";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";

/**
 * The household's active-person chip.
 *
 * People are convenience scopes, not accounts (D-051): this menu deliberately
 * looks like a profile picker, not a login. The active person is stored in an
 * opaque cookie and validated server-side on every request, so a hand-edited
 * value can only select another person in the same trusted household.
 */

type PersonOption = { id: string; displayName: string };

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function PersonSwitcher({
  people,
  activePersonId,
}: {
  people: PersonOption[];
  activePersonId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = people.find((person) => person.id === activePersonId) ?? people[0];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(personId: string) {
    if (personId === activePersonId) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await switchPersonAction(personId);
      if (!result.ok) {
        setError(result.message ?? "Could not switch people.");
        return;
      }
      setOpen(false);
      router.refresh();
      triggerRef.current?.focus();
    });
  }

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1 + items.length) % items.length
        : (index - 1 + items.length) % items.length;
    items[next].focus();
  }

  if (!active) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Active person: ${active.displayName}. Switch person`}
        onClick={() => {
          setError(null);
          setOpen((previous) => !previous);
        }}
        disabled={pending}
        className="flex h-9 max-w-[10.5rem] items-center gap-1.5 rounded-lg border border-line/70 bg-surface/60 pl-1 pr-2 text-left transition hover:bg-ink/5 disabled:opacity-60"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
          {initialOf(active.displayName)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {active.displayName}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Switch person"
          onKeyDown={moveFocus}
          className="absolute right-0 z-30 mt-1.5 w-60 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
            This device
          </p>
          {people.map((person) => {
            const current = person.id === activePersonId;
            return (
              <button
                key={person.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                aria-current={current ? "true" : undefined}
                onClick={() => choose(person.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-ink/5 focus:bg-accent/10 focus:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
                  {initialOf(person.displayName)}
                </span>
                <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
                {current && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            );
          })}

          <div className="my-1 border-t border-line/70" />
          <Link
            href="/settings#people"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2.5 py-2 text-xs text-muted transition hover:bg-ink/5 hover:text-ink focus:bg-accent/10 focus:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Manage people…
          </Link>

          {error && (
            <p role="alert" className="mx-1 mt-1 rounded-lg bg-danger-soft px-2 py-1.5 text-[10px] text-danger-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
