/**
 * Free-text notes attached to recipe blocks (ingredients and process steps).
 *
 * Notes are optional, empty by default, and never affect nutrition: the
 * engine never reads them. They exist so technique, consistency, doneness
 * and sensory guidance can live next to the block it applies to instead of
 * pretending to be a process step.
 */

/** Longest note we keep, everywhere: editor, AI, fragments, saves. */
export const MAX_NOTE_LENGTH = 1000;

/**
 * Trim and cap a note. Returns `undefined` for anything empty or
 * non-textual, so callers can omit the field entirely rather than storing
 * whitespace. Newlines inside a note are preserved.
 */
export function cleanNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : undefined;
}
