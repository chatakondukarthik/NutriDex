"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ImportMode, ImportReport } from "@/lib/archive/import";
import type { ArchiveScope } from "@/lib/archive/registry";

/**
 * Export and import.
 *
 * Three rules shape the UI:
 *
 *   1. the scope is explicit. A household archive carries every person and
 *      the shared library; a person archive carries one person plus the
 *      shared library; a shared archive carries no people at all.
 *   2. an import is never a single click — the archive must pass "Check"
 *      (a dry run through the real importer) before "Import" enables;
 *   3. the copy says what leaves the machine. Archives contain content, never
 *      AI keys.
 */

type Checked = { name: string; size: number; mode: ImportMode; targetPersonId: string };
type PersonOption = { id: string; displayName: string };

const SCOPE_LABEL: Record<ArchiveScope, string> = {
  household: "household",
  person: "person",
  shared: "shared library",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataPortabilityPanel({
  people,
  activePersonId,
}: {
  people: PersonOption[];
  activePersonId: string;
}) {
  const router = useRouter();

  const [exportScope, setExportScope] = useState<ArchiveScope>("household");
  const [exportPersonId, setExportPersonId] = useState(activePersonId);
  const [includeAi, setIncludeAi] = useState(false);
  const [includeSnapshot, setIncludeSnapshot] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [targetPersonId, setTargetPersonId] = useState(activePersonId);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("scope", exportScope);
    if (exportScope === "person") params.set("person", exportPersonId);
    if (exportScope === "household" && includeAi) params.set("ai", "1");
    if (exportScope === "household" && !includeSnapshot) params.set("snapshot", "0");
    return `/api/export?${params.toString()}`;
  }, [exportScope, exportPersonId, includeAi, includeSnapshot]);

  const checkMatches =
    checked !== null &&
    file !== null &&
    checked.name === file.name &&
    checked.size === file.size &&
    checked.mode === mode &&
    checked.targetPersonId === targetPersonId;

  const exportPersonName =
    people.find((person) => person.id === exportPersonId)?.displayName ?? "this person";
  const targetPersonName =
    people.find((person) => person.id === targetPersonId)?.displayName ?? "this person";

  function resetCheck() {
    setChecked(null);
    setReport(null);
    setError(null);
  }

  async function submit(dryRun: boolean) {
    if (!file) return;
    setError(null);
    setBusy(dryRun ? "check" : "apply");

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mode", mode);
      body.set("targetPersonId", targetPersonId);
      if (dryRun) body.set("dryRun", "1");

      const response = await fetch("/api/import", { method: "POST", body });
      const payload = (await response.json()) as ImportReport | { ok: false; error: string };

      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        setReport(null);
        setChecked(null);
        setError("error" in payload ? payload.error : "The archive could not be read.");
        return;
      }

      setReport(payload);
      if (dryRun) setChecked({ name: file.name, size: file.size, mode, targetPersonId });
      else {
        setChecked(null);
        router.refresh();
      }
    } catch {
      setError("The import request failed. Is the app still running?");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Your data</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Everything lives on this machine. An archive is a single ZIP with one JSON line per row,
        evidence images, and a manifest of checksums. It never contains your AI keys.
      </p>

      <div className="mt-4 rounded-xl border border-line bg-bg p-4">
        <h3 className="text-xs font-semibold">Export</h3>

        <label className="mt-2 block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink/40">
            What to include
          </span>
          <select
            value={exportScope}
            onChange={(event) => setExportScope(event.target.value as ArchiveScope)}
            className="mt-1 w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[11px] text-ink outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
          >
            <option value="household">Whole household — every person and the shared library</option>
            <option value="person">One person — their data plus the shared library</option>
            <option value="shared">Shared library only — recipes, foods and preferences</option>
          </select>
        </label>

        {exportScope === "person" && (
          <label className="mt-2 block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink/40">
              Person
            </span>
            <select
              value={exportPersonId}
              onChange={(event) => setExportPersonId(event.target.value)}
              className="mt-1 w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[11px] text-ink outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] leading-relaxed text-ink/40">
              Contains {exportPersonName}&apos;s diary, plans, body profile, defaults and
              thresholds, plus the whole shared library so it can stand alone. It never contains
              another person&apos;s rows.
            </span>
          </label>
        )}

        {exportScope === "household" && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] leading-relaxed text-ink/40">
              This archive contains every person in this household.
            </p>
            <label className="flex items-start gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={includeSnapshot}
                onChange={(event) => setIncludeSnapshot(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Include a full database snapshot
                <span className="block text-[10px] text-ink/40">
                  A consistent SQLite copy for disaster recovery. The importer does not need it.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={includeAi}
                onChange={(event) => setIncludeAi(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Include the AI activity log
                <span className="block text-[10px] text-ink/40">
                  Provider, model, tokens and status — no prompts. Off by default.
                </span>
              </span>
            </label>
          </div>
        )}

        <a
          href={exportHref}
          className="mt-3 inline-block rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong"
        >
          Download {SCOPE_LABEL[exportScope]} archive
        </a>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-bg p-4">
        <h3 className="text-xs font-semibold">Import</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Restoring never happens in one click: check the archive first, then apply it.
        </p>

        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Archive to import"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            resetCheck();
          }}
          className="mt-3 block w-full text-[11px] text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[11px] file:font-medium file:text-ink"
        />

        {file && (
          <p className="mt-1 text-[10px] text-ink/40">
            {file.name} · {formatBytes(file.size)}
          </p>
        )}

        <label className="mt-3 block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink/40">
            Restore personal data into
          </span>
          <select
            value={targetPersonId}
            onChange={(event) => {
              setTargetPersonId(event.target.value);
              resetCheck();
            }}
            className="mt-1 w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[11px] text-ink outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] leading-relaxed text-ink/40">
            A person archive lands on {targetPersonName}. Archives from before household support
            import as a single person. Household and shared archives ignore this choice.
          </span>
        </label>

        <fieldset className="mt-3">
          <legend className="text-[10px] font-medium uppercase tracking-wide text-ink/40">
            How to apply it
          </legend>
          <label className="mt-1 flex items-start gap-2 text-[11px] text-muted">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => {
                setMode("merge");
                resetCheck();
              }}
              className="mt-0.5"
            />
            <span>
              Merge into what is here
              <span className="block text-[10px] text-ink/40">
                Adds what is missing. Rows that already exist are kept, and differences are
                reported rather than overwritten.
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-[11px] text-muted">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => {
                setMode("replace");
                resetCheck();
              }}
              className="mt-0.5"
            />
            <span>
              Replace matching data
              <span className="block text-[10px] text-ink/40">
                Replace deletes this household&apos;s people, diaries, recipes and plans first. A
                household archive replaces everyone and the shared library. A person archive
                replaces only that person&apos;s personal rows; shared rows are merged. A shared
                archive replaces the shared library. This cannot be undone.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!file || busy !== null}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            {busy === "check" ? "Checking…" : "Check archive"}
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!checkMatches || busy !== null}
            className="rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {busy === "apply" ? "Importing…" : mode === "replace" ? "Replace with archive" : "Import"}
          </button>
          {!checkMatches && file && (
            <span className="text-[10px] text-ink/40">Check the archive before importing.</span>
          )}
        </div>

        <div aria-live="polite" className="mt-3">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {report && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="text-[11px] font-medium">
                {report.dryRun ? "Archive checked — nothing was written." : "Import complete."}
              </p>
              <p className="mt-0.5 text-[10px] text-ink/40">
                Format v{report.formatVersion} · {SCOPE_LABEL[report.scope]} archive · exported{" "}
                {report.exportedAt.slice(0, 10)} · {report.mode === "replace" ? "replace" : "merge"}
                {report.personId &&
                  ` · ${
                    people.find((person) => person.id === report.personId)?.displayName ??
                    "person"
                  }`}
                {report.files.written > 0 && ` · ${report.files.written} image(s) restored`}
              </p>

              <table className="mt-2 w-full text-left text-[10px]">
                <thead className="text-ink/40">
                  <tr>
                    <th className="py-1 font-medium">Table</th>
                    <th className="py-1 text-right font-medium">In archive</th>
                    <th className="py-1 text-right font-medium">Added</th>
                    <th className="py-1 text-right font-medium">Kept</th>
                    <th className="py-1 text-right font-medium">Differs</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {report.tables.map((table) => (
                    <tr key={table.table} className="border-t border-line/60">
                      <td className="py-1">{table.label}</td>
                      <td className="py-1 text-right">{table.archiveRows}</td>
                      <td className="py-1 text-right">{table.added}</td>
                      <td className="py-1 text-right">{table.kept}</td>
                      <td className="py-1 text-right">{table.conflicts || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {report.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[10px] text-amber-600 dark:text-amber-400">
                  {report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
