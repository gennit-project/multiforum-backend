import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareSchemas, frontendRepository, readOperations, readSchema, readSupportList } from "./frontendCompatibility.js";
import { sha256 } from "./schemaContract.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/frontend-compatibility");
// Only immutable public data is fetched. No frontend code, package installation,
// tokens, live endpoints, mutable refs, or caller-supplied URLs are accepted.
function fetchData(revision: string, file: string): string {
  return execFileSync("curl", ["--fail", "--silent", "--show-error", "--max-time", "60", "--max-filesize", "10000000", `https://raw.githubusercontent.com/${frontendRepository}/${revision}/${file}`], { encoding: "utf8", maxBuffer: 10_000_000 });
}
async function main() {
  if (process.argv.length !== 2) throw new Error("Usage: pnpm schema:compatibility (no overrides)");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("Compatibility gate requires a clean candidate checkout");
  const candidateDirectory = path.join(root, "artifacts/graphql-schema");
  const candidate = readSchema(readFileSync(path.join(candidateDirectory, "schema.graphql"), "utf8"), readFileSync(path.join(candidateDirectory, "manifest.json"), "utf8"), revision);
  if (candidate.manifest.lockfileSha256 !== sha256(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"))) throw new Error("Candidate lockfile provenance mismatch");
  const supportText = readFileSync(path.join(root, "graphql-compatibility/supported-frontends.json"), "utf8");
  const results = [];
  for (const client of readSupportList(supportText)) {
    const content = fetchData(client.revision, "graphql-operations/operations.json");
    const contract = readOperations(content, client);
    const sdl = fetchData(client.revision, "graphql-schema/schema.graphql");
    const manifest = fetchData(client.revision, "graphql-schema/manifest.json");
    const baseline = readSchema(sdl, manifest, contract.pinnedSchema.revision);
    if (baseline.manifest.files["schema.graphql"].sha256 !== contract.pinnedSchema.sha256) throw new Error("Baseline must be the original schema pinned by the supported frontend");
    if (sha256(fetchData(client.revision, "pnpm-lock.yaml")) !== contract.lockfileSha256) throw new Error("Frontend lockfile provenance mismatch");
    const directory = path.join(output, client.revision);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "operations.json"), content);
    writeFileSync(path.join(directory, "schema.graphql"), sdl);
    writeFileSync(path.join(directory, "schema-manifest.json"), manifest);
    results.push({ frontend: { repository: frontendRepository, ...client }, baseline: baseline.manifest, ...compareSchemas(candidate.schema, baseline.schema, contract) });
  }
  const report = { formatVersion: 1, candidate: candidate.manifest, supportListSha256: sha256(supportText), compatible: results.every((result) => result.compatible), results };
  writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.compatible) throw new Error("Publication blocked: repair operations/schema changes or obtain a coordinated support-window migration review. Never refresh the original baseline to hide a break.");
}
main().catch((error: unknown) => {
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "failure.txt"), `${String(error)}\n`);
  console.error("Frontend compatibility failed:", error);
  process.exitCode = 1;
});
