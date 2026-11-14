import { addVersion, createRecipe } from "@/lib/db/recipes";
import { prepareVersion, type RecipeDraft } from "@/lib/recipe-validate";

/**
 * The recipe service.
 *
 * This is the only place a draft becomes a stored version. Unit
 * conversion, food resolution and the nutrition snapshot all happen
 * here, on the server, for the same reason the diary does it here: the
 * client must never be the authority on a gram weight.
 *
 * Validation lives in `recipe-validate.ts` so it can be tested without a
 * database.
 */

export type { RecipeDraft };

export type SaveResult =
  | { ok: true; recipeId: string; versionId: string; versionNo: number }
  | { ok: false; message: string };

export function saveRecipeDraft(draft: RecipeDraft): SaveResult {
  const prepared = prepareVersion(draft);
  if (!prepared.ok) return prepared;

  const name = draft.name.trim();
  const saved = draft.recipeId
    ? addVersion(draft.recipeId, prepared.version, name)
    : createRecipe({ name }, prepared.version);

  return { ok: true, ...saved };
}
