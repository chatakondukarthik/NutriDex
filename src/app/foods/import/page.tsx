import { InndbImporter } from "@/components/inndb-importer";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <h1 className="font-display mt-1.5 text-[26px] font-bold leading-none tracking-tight text-ink">Import foods from CSV</h1>
      <p className="mt-1 text-xs text-muted">
        Paste a food-composition table (INDB, USDA, or your own). The default column
        mapping matches a typical INDB export; edit the JSON mapping if your columns differ.
      </p>
      <InndbImporter />
    </main>
  );
}
