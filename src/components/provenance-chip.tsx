import { cn } from "@/lib/cn";
import type { Provenance } from "@/lib/provenance";

/**
 * The one provenance badge the foods list, the detail pages and the recipes
 * list share. Quiet by default: a measured value should not scream.
 */
export function ProvenanceChip({
  provenance,
  className,
}: {
  provenance: Provenance;
  className?: string;
}) {
  return (
    <span
      title={provenance.title}
      className={cn(
        "inline-flex items-center rounded bg-ink/[0.07] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/55",
        className,
      )}
    >
      {provenance.short}
    </span>
  );
}
