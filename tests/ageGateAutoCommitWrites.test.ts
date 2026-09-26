import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every write that creates age-gated content must run in a managed or explicit
// transaction, where the age-gate reconcile step runs before commit
// (services/ageGate/reconcile.ts). An auto-commit `session.run` can't be
// extended that way, so content it created could be committed unflagged.
// This fails if one creates or merges a node of an age-gated type.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_DIRS = ["customResolvers", "services", "rules", "middleware", "hooks"];
const AGE_GATED_LABELS = "Comment|TextVersion|Issue|DiscussionChannel|DownloadableFile|FileVersion|Discussion|Image";
const CREATES_AGE_GATED_NODE = new RegExp(`\\b(CREATE|MERGE)\\s*\\(\\s*\\w*\\s*:\\s*(${AGE_GATED_LABELS})\\b`);

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });

// Map `import someQuery from "./x.cypher"`-style bindings to file contents.
const importedCypher = (file: string, source: string): Map<string, string> => {
  const imports = new Map<string, string>();
  for (const match of source.matchAll(/(?:const|import)\s+(\w+)\s*=?\s*(?:from\s*)?[^;\n]*?["']([^"']+\.cypher)["']/g)) {
    const cypherPath = path.resolve(path.dirname(file), match[2]);
    if (fs.existsSync(cypherPath)) imports.set(match[1], fs.readFileSync(cypherPath, "utf8"));
  }
  return imports;
};

// Queries loaded centrally, e.g.
// `export const fooQuery = fs.readFileSync(path.resolve(__dirname, "./foo.cypher"), "utf8")`.
const centralCypher = (): Map<string, string> => {
  const queries = new Map<string, string>();
  const registry = path.join(ROOT, "customResolvers/cypher/cypherQueries.ts");
  if (!fs.existsSync(registry)) return queries;
  const source = fs.readFileSync(registry, "utf8");
  for (const match of source.matchAll(/export const (\w+)\s*=\s*fs\.readFileSync\([^'"]*['"]\.\/([^'"]+\.cypher)['"]/g)) {
    const cypherPath = path.join(path.dirname(registry), match[2]);
    if (fs.existsSync(cypherPath)) queries.set(match[1], fs.readFileSync(cypherPath, "utf8"));
  }
  return queries;
};

const autoCommitAgeGatedWrites = (): string[] => {
  const offenders: string[] = [];
  const central = centralCypher();
  for (const dir of SCANNED_DIRS) {
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const file of sourceFiles(absolute)) {
      const source = fs.readFileSync(file, "utf8");
      const cypher = importedCypher(file, source);
      for (const call of source.matchAll(/session\.run\(\s*(?:([`"'])([\s\S]*?)\1|(\w+))/g)) {
        const query =
          call[2] ?? cypher.get(call[3] ?? "") ?? central.get(call[3] ?? "") ?? "";
        if (CREATES_AGE_GATED_NODE.test(query)) {
          const line = source.slice(0, call.index).split("\n").length;
          offenders.push(`${path.relative(ROOT, file)}:${line}`);
        }
      }
    }
  }
  return offenders;
};

test("central .cypher queries are resolved", () => {
  assert.ok(centralCypher().get("createDiscussionChannelQuery")?.includes("CREATE (newDc:DiscussionChannel"));
});

test("no auto-commit session.run creates age-gated content", () => {
  assert.deepEqual(autoCommitAgeGatedWrites(), []);
});
