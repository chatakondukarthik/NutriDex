"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { makeCurrentRecipeVersionAction } from "@/app/actions";

/**
 * Promote any version to be the current one.
 *
 * Deliberately one click — plans and diary entries keep the version they
 * were saved against; this only shifts where new logs come from.
 */
export function MakeCurrentButton({
  recipeId,
  versionId,
  versionNo,
}: {
  recipeId: string;
  versionId: string;
  versionNo: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await makeCurrentRecipeVersionAction({ recipeId, versionId });
            if (!result.ok) {
              setError(result.message ?? "Could not make that version current.");
              return;
            }
            router.refresh();
          });
        }}
        className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
      >
        {pending ? "Switching…" : `Make v${versionNo} current`}
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-danger-ink">
          {error}
        </span>
      )}
    </span>
  );
}
