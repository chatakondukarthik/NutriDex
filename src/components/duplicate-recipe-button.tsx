"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { duplicateRecipeAction } from "@/app/actions";

export function DuplicateRecipeButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await duplicateRecipeAction(recipeId);
          if (result.ok && result.recipeId) router.push(`/recipes/${result.recipeId}`);
        })
      }
      className="rounded-lg border border-line px-3.5 py-2 text-xs font-medium text-ink/60 transition hover:bg-ink/5 disabled:opacity-50"
    >
      {pending ? "Duplicating…" : "Duplicate"}
    </button>
  );
}
