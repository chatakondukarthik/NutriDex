"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpIcon, SparkleIcon } from "@/components/icons";

/**
 * The AI command bar — one floating pill, bottom-center of the canvas.
 *
 * Replaces the old per-page buttons. Whatever is on the canvas is what the
 * model sees (an empty canvas reads as a create prompt; anything else reads
 * as "modify this"), because the editor serializes the live graph and the
 * generator reads it at submit time.
 *
 * ⌘K focuses it. Enter submits. The pill never covers the mode toggle or
 * the zoom controls — the canvas keeps its corners.
 */
export function AiCanvasBar({
  enabled,
  placeholder,
  onSubmit,
}: {
  enabled: boolean;
  placeholder: string;
  onSubmit: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // SSR and client agree for Mac; non-Mac hydrators swap in Ctrl K.
  const [isMac] = useState(() =>
    typeof navigator === "undefined" ? true : /Mac|iPhone|iPad/.test(navigator.userAgent),
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!enabled) {
    return (
      <div
        className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4"
        style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <Link
          href="/settings"
          className="pointer-events-auto flex w-full max-w-lg items-center gap-2 rounded-full border border-line/80 bg-surface/85 py-2 pl-4 pr-2 text-xs text-muted backdrop-blur transition hover:text-ink"
        >
          <SparkleIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">AI is off — turn it on in Settings</span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-faint">Settings →</span>
        </Link>
      </div>
    );
  }

  return (
    <form
      role="search"
      aria-label="Ask AI about this recipe"
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        if (!text) return;
        onSubmit(text);
        setValue("");
      }}
      className="absolute inset-x-0 z-10 mx-auto flex w-full max-w-lg items-center gap-2 rounded-full border border-accent/35 bg-surface/85 py-1.5 pl-4 pr-1.5 backdrop-blur transition focus-within:border-accent/60"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom))",
        boxShadow: "0 14px 40px -14px oklch(0.72 0.16 62 / 0.45)",
      }}
    >
      <SparkleIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <label htmlFor="ai-canvas-prompt" className="sr-only">
        Ask AI about this recipe
      </label>
      <input
        id="ai-canvas-prompt"
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/35 focus:outline-none focus-visible:outline-none"
      />
      <kbd
        suppressHydrationWarning
        className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-ledger text-[10px] text-ink/45 sm:inline-block"
        aria-hidden="true"
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
      <button
        type="submit"
        disabled={!value.trim()}
        aria-label="Ask AI"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
      >
        <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
