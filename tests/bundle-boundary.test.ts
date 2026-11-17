import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ts from "typescript";

/**
 * S-005 — no secret can reach the client bundle.
 *
 * A runtime test cannot see the bundle, and a build is too slow for the
 * unit suite. What can be checked cheaply is the import graph: start at
 * every `"use client"` module, follow the imports the bundler will follow,
 * and refuse any path that reaches a module which reads keys, opens the
 * database, or touches the filesystem.
 *
 * Type-only imports are erased by the compiler, so they are allowed — that
 * is how `DataPortabilityPanel` shares the `ImportReport` type without
 * importing the importer.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src");

/** Modules that must never be reachable from a client entry. */
const SERVER_ONLY = new Set(
  [
    "src/lib/ai/secrets.ts",
    "src/lib/ai/config.ts",
    "src/lib/ai/client.ts",
    "src/lib/ai/adapters.ts",
    "src/lib/db/client.ts",
    "src/lib/data-dir.ts",
    "src/lib/security/private-files.ts",
    "src/lib/archive/export.ts",
    "src/lib/archive/import.ts",
    "src/lib/archive/zip.ts",
    "src/lib/food-sources/usda.ts",
  ].map((file) => path.join(ROOT, file)),
);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isClientModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

/**
 * A `"use server"` module is replaced by an RPC reference in the client
 * bundle; its imports are not bundled. Traversing into one would report the
 * whole database layer as a leak.
 */
function isServerModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function specifiers(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteral(node)) found.push(node.text);
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause?.isTypeOnly) add(statement.moduleSpecifier);
    } else if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) add(statement.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly && ts.isExternalModuleReference(statement.moduleReference)) {
        add(statement.moduleReference.expression);
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function clientGraph(): { entries: string[]; reachable: Set<string> } {
  const all = walk(SRC);
  const entries = all.filter((file) => isClientModule(parse(file)));
  const reachable = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reachable.has(file)) continue;
    reachable.add(file);

    const source = parse(file);
    if (isServerModule(source)) continue;

    for (const specifier of specifiers(source)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !reachable.has(resolved)) queue.push(resolved);
    }
  }

  return { entries, reachable };
}

describe("client bundle boundary", () => {
  const { entries, reachable } = clientGraph();

  it("finds the client entry points", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it("never reaches a server-only module", () => {
    const leaked = [...reachable].filter((file) => SERVER_ONLY.has(file));
    expect(leaked.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("never reaches a module that reads process.env, the filesystem or node builtins", () => {
    const offenders: string[] = [];

    for (const file of reachable) {
      const text = readFileSync(file, "utf8");
      const source = parse(file);
      const specifiersUsed = specifiers(source);
      const usesNodeBuiltin = specifiersUsed.some((specifier) => specifier.startsWith("node:"));
      const usesEnv = /\bprocess\s*\.\s*env\b/.test(text);
      const usesFilesystem = /\b(?:readFileSync|writeFileSync|createReadStream)\s*\(/.test(text);
      const namesASecret = /NUTRIPLAN_AI_[A-Z_]*_KEY/.test(text);

      if (usesNodeBuiltin || usesEnv || usesFilesystem || namesASecret) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not accidentally scan nothing", () => {
    // A refactor that renamed the directive or moved the secret module would
    // otherwise turn this file into a green no-op.
    expect(reachable.size).toBeGreaterThan(30);
    expect([...SERVER_ONLY].every((file) => existsSync(file))).toBe(true);
  });
});
