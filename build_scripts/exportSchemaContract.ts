import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicSchema } from "./publicSchema.js";
import { createSchemaContract } from "./schemaContract.js";

const root = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: pnpm schema:export [output-directory]");
  const output = path.resolve(root, args[0] ?? "artifacts/graphql-schema");
  const git = (...options: string[]) =>
    execFileSync("git", options, { cwd: root, encoding: "utf8" }).trim();
  // A commit label must identify the source that actually produced this API.
  // Reject uncommitted sources rather than labeling local changes as HEAD.
  if (git("status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("Schema export requires a clean checkout. Commit source changes first.");
  }
  const revision = git("rev-parse", "HEAD");
  const dependencies = Object.fromEntries(
    ["@neo4j/graphql", "graphql", "neo4j-driver"].map((name) => [
      name, (JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")) as { version: string }).version,
    ]),
  );
  const schema = await buildPublicSchema();
  const contract = createSchemaContract(
    schema, revision, dependencies, readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"),
  );
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "schema.graphql"), contract.sdl);
  writeFileSync(path.join(output, "manifest.json"), contract.manifest);
  console.log(`Exported GraphQL schema from ${revision} to ${output}`);
}

main().catch((error: unknown) => {
  console.error("Schema contract export failed:", error);
  process.exitCode = 1;
});
