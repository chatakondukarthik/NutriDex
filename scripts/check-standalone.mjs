#!/usr/bin/env node
/**
 * Fail the build if local runtime state leaked into the standalone output.
 *
 * Next's file tracer follows `path.join(process.cwd(), "data")` from
 * `src/lib/data-dir.ts` and will copy the live SQLite database and
 * `data/secrets.json` into `.next/standalone` unless they are excluded. That
 * artifact is what the Dockerfile ships and what people tar up for a
 * non-Docker deploy, so a copied key would travel with it.
 *
 * `outputFileTracingExcludes` in `next.config.ts` is the fix. This script is
 * the regression test: if a future change makes tracing include the data
 * directory again, `npm run build` fails instead of quietly producing an
 * image that contains someone's API key.
 *
 * It prints file names only, never contents.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const standalone = path.join(process.cwd(), ".next", "standalone");
if (!existsSync(standalone)) {
  // Not every Next configuration emits a standalone directory.
  process.exit(0);
}

const findings = [];

/** Directories that are dependencies, not project state. */
const SKIP = new Set(["node_modules", ".git"]);

function walk(dir, rel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Only the project's own `data/` directory matters. A nested directory
      // with the same name (a route called `/data`, say) is not runtime state.
      if (rel === "" && entry.name === "data") {
        findings.push("data/ (runtime data directory)");
        continue;
      }
      walk(abs, relPath);
      continue;
    }

    if (
      entry.name === "secrets.json" ||
      entry.name === "ai-config.json" ||
      entry.name === ".env" ||
      entry.name.startsWith(".env.") ||
      /\.(sqlite|db)(-wal|-shm|-journal)?$/.test(entry.name)
    ) {
      const size = statSync(abs).size;
      findings.push(`${relPath} (${size} bytes)`);
    }
  }
}

walk(standalone, "");

if (findings.length > 0) {
  console.error(
    "\nBuild output contains local state. This is a security problem: the\n" +
      "standalone directory is what gets deployed, and it must never carry a\n" +
      "database or an API key.\n",
  );
  for (const finding of findings) console.error(`  .next/standalone/${finding}`);
  console.error(
    "\nCheck `outputFileTracingExcludes` in next.config.ts, then rebuild.\n",
  );
  process.exit(1);
}
