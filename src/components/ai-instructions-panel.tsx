"use client";

import { useState, useTransition } from "react";
import { saveMasterPromptAction, resetMasterPromptAction } from "@/app/actions";
import { DEFAULT_MASTER_PROMPT } from "@/lib/ai/master-prompt";

export function AiInstructionsPanel({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: string) {
    setSaved(null);
    startTransition(async () => {
      const result = await saveMasterPromptAction(next);
      setSaved(result.ok ? "Saved." : result.message ?? "Could not save.");
    });
  }

  function reset() {
    setSaved(null);
    startTransition(async () => {
      await resetMasterPromptAction();
      setValue(DEFAULT_MASTER_PROMPT);
      setSaved("Reset to the built-in default.");
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold">Global AI instructions</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Prepended to every AI task (recipe planning, nutrient estimation, capture). Tell it who
        you are and how you cook — e.g. “I am from Bengaluru and cook South Indian food; prefer
        IFCT 2017 values over USDA where they differ; if you are unsure of a value, omit it
        rather than guess.”
      </p>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={4}
        maxLength={2000}
        aria-label="Global AI instructions"
        className="mt-3 w-full rounded-xl border border-line bg-bg px-3 py-2 text-xs leading-relaxed outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] tabular text-ink/35">{value.length}/2000</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[11px] text-accent">{saved}</span>}
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => save(value)}
            disabled={pending || value === initial}
            className="rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </div>
    </section>
  );
}
