import { InndbImporter } from "@/components/inndb-importer";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Import foods from CSV</h1>
      <p className="mt-1 text-xs text-muted">
        Paste a food-composition table (INDB, USDA, or your own). The default column
        mapping matches a typical INDB export; edit the JSON mapping if your columns differ.
      </p>
      <InndbImporter />
    </main>
  );
}
