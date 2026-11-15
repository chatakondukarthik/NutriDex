"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estimateAllFoodsAction } from "@/app/actions";

/**
 * One click, all captured foods with unknown nutrients get estimated in a
 * single pass. One LLM call per food (not per nutrient), capped server
 * side, so a free-tier quota is not drained by accident.
 */
export function BulkEstimateButton({
  pendingFoods,
  aiEnabled,
  hasKey,
}: {
  pendingFoods: number;
  aiEnabled: boolean;
  hasKey: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const blocked = !aiEnabled
    ? "AI is turned off in Settings."
    : !hasKey
      ? "Add an AI key in Settings first."
      : pendingFoods === 0
        ? "Every captured food has full nutrient data."
        : null;

  if (blocked) {
    return (
      <button
        type="button"
        disabled
        title={blocked}
        className="cursor-not-allowed rounded-lg border border-line bg-bg px-3 py-1.5 text-[11px] font-semibold text-muted opacity-60"
      >
        ✨ Fill all with AI ({pendingFoods})
      </button>
    );
  }

  if (done) {
    return (
      <p role="status" className="max-w-xs text-right text-[10px] leading-snug text-muted">
        {message}
      </p>
    );
  }

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await estimateAllFoodsAction();
      setMessage(result.message ?? (result.ok ? "Done." : "Failed."));
      if (result.ok) setDone(true);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      title={`Estimates every captured food with unknown nutrients in one click. One AI call per food — uses roughly ${pendingFoods} call${pendingFoods === 1 ? "" : "s"}.`}
      className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
    >
      {pending ? "Estimating…" : `✨ Fill all with AI (${pendingFoods})`}
    </button>
  );
}
