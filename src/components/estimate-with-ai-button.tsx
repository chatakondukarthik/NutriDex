"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SparkleIcon } from "@/components/icons";
import { estimateFoodNutrientsAction } from "@/app/actions";
import { EstimateFoodsDialog } from "@/components/estimate-foods-dialog";
import type { NutrientCode } from "@/lib/nutrition/types";

export function EstimateWithAiButton({
  foodId,
  foodName,
  missingCount,
  missingCodes,
  aiEnabled,
  hasKey,
  source,
  className,
}: {
  foodId: string;
  /** For the dialog's list row. */
  foodName: string;
  missingCount: number;
  /** Codes currently unknown — the pickable set. */
  missingCodes: NutrientCode[];
  aiEnabled: boolean;
  hasKey: boolean;
  /** Provenance, so the copy can be honest about what kind of food this is. */
  source?: string;
  /** Extra trigger classes (the stacked mobile layout uses them). */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = !aiEnabled
    ? "AI is turned off in Settings."
    : !hasKey
      ? "Add an AI key in Settings first."
      : missingCount === 0
        ? "Every nutrient is filled in."
        : null;

  const provenanceNote =
    source === "usda"
      ? "This food came from USDA — values it reports stay untouched; AI only fills what USDA never measured."
      : source === "llm"
        ? "AI read or estimated this food's values before; this fills in the rest the same way."
        : undefined;

  function go(codes: NutrientCode[]) {
    setOpen(false);
    setMessage(null);
    startTransition(async () => {
      const result = await estimateFoodNutrientsAction(foodId, codes);
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
        Estimate {missingCount} missing with AI
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50 ${className ?? ""}`}
      >
        <SparkleIcon className="h-3.5 w-3.5" />
        Estimate {missingCount} missing with AI
      </button>
      {message && (
        <p role="status" className="max-w-xs text-right text-[10px] leading-snug text-muted">
          {message}
        </p>
      )}
      <EstimateFoodsDialog
        open={open}
        foods={[{ id: foodId, name: foodName, missingCodes }]}
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={go}
        provenanceNote={provenanceNote}
      />
    </div>
  );
}
