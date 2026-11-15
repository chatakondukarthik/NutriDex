"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estimateFoodNutrientsAction } from "@/app/actions";

export function EstimateWithAiButton({
  foodId,
  missingCount,
  aiEnabled,
  hasKey,
}: {
  foodId: string;
  missingCount: number;
  aiEnabled: boolean;
  hasKey: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = !aiEnabled
    ? "AI is turned off in Settings."
    : !hasKey
      ? "Add an AI key in Settings first."
      : missingCount === 0
        ? "Every nutrient is filled in."
        : null;

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await estimateFoodNutrientsAction(foodId);
      setMessage(result.message ?? (result.ok ? "Done." : "Could not estimate."));
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <button
        type="button"
        disabled
        title={blocked}
        className="cursor-not-allowed rounded-lg border border-line bg-bg px-3 py-1.5 text-xs font-semibold text-muted opacity-60"
      >
        ✨ Estimate missing with AI ({missingCount})
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
      >
        {pending ? "Estimating…" : `✨ Estimate ${missingCount} missing with AI`}
      </button>
      {message && (
        <p role="status" className="max-w-xs text-right text-[10px] leading-snug text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
