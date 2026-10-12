import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".claude",
  "coverage",
  "docs",
  "node_modules",
  "src",
  "tests",
  "ts_emitted",
]);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...await sourceFiles(path.join(directory, entry.name)));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".cypher")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
};

test("production Cypher has no unbounded IS_REPLY_TO traversal", async () => {
  const offenders: string[] = [];
  for (const filename of await sourceFiles(ROOT)) {
    const source = await readFile(filename, "utf8");
    if (/IS_REPLY_TO\*(?:\d+)?\.\.\]/.test(source)) {
      offenders.push(path.relative(ROOT, filename));
    }
  }
  assert.deepEqual(offenders, []);
});
