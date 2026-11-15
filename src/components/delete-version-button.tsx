"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteRecipeVersionAction } from "@/app/actions";

/**
 * Delete one version of a recipe, with confirmation.
 *
 * The server re-checks everything (the only remaining version, plan/diary
 * references); disabling here would duplicate the rule and drift.
 */
export function DeleteVersionButton({
  recipeId,
  versionId,
  versionNo,
}: {
  recipeId: string;
  versionId: string;
  versionNo: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteRecipeVersionAction({ recipeId, versionId });
      if (!result.ok) {
        setMessage(result.message ?? "Could not delete that version.");
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11px] text-ink/40 transition hover:text-danger-ink"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-danger-line bg-danger-soft px-2 py-1 text-[10px] text-danger-ink">
      <span>
        Delete v{versionNo}? Refused while plans or diary entries pin it.
      </span>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-md bg-danger px-2 py-0.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md border border-danger-line bg-surface px-2 py-0.5 font-medium text-ink/70"
      >
        Keep
      </button>
      {message && (
        <p role="alert" className="w-full text-[10px] text-danger-ink">
          {message}
        </p>
      )}
    </span>
  );
}
