import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchema } from "graphql";
import { compareSchemas, frontendRepository, readOperations, readSchema, readSupportList, type OperationContract } from "./frontendCompatibility.js";
import { createSchemaContract, sha256 } from "./schemaContract.js";
const revision = "a".repeat(40);
const source = "query Read { value }";
const contract: OperationContract = { formatVersion: 1, repository: frontendRepository, lockfileSha256: "b".repeat(64), pinnedSchema: { repository: "gennit-project/multiforum-backend", revision, sha256: "c".repeat(64) }, sources: [{ file: "graphQLData/read.ts", sha256: "d".repeat(64) }], documents: [{ id: "Read", file: "graphQLData/read.ts", line: 5, column: 1, source, sha256: sha256(source) }] };
const client = (value = contract) => ({ revision, operationsSha256: sha256(JSON.stringify(value)), documents: 1, purpose: "source test" });
const read = (value: OperationContract) => readOperations(JSON.stringify(value), client(value));
const schema = buildSchema("type Query { value: String! }");

test("accepts immutable support pins and complete operation provenance", () => {
  assert.deepEqual(readSupportList(JSON.stringify({ formatVersion: 1, repository: frontendRepository, clients: [client()] })), [client()]);
  assert.deepEqual(read(contract), contract);
});
for (const clients of [[], [{ ...client(), revision: "main" }], [{ ...client(), operationsSha256: "bad" }], [{ ...client(), documents: 0 }], [client(), client()]]) {
  test(`rejects absent, mutable, malformed or duplicate support pins ${JSON.stringify(clients)}`, () => assert.throws(() => readSupportList(JSON.stringify({ formatVersion: 1, repository: frontendRepository, clients }))));
}
test("rejects stale or tampered bundles before parsing", () => assert.throws(() => readOperations(`${JSON.stringify(contract)}\n`, client()), /checksum/));
for (const change of [
  (v: OperationContract) => { v.documents = []; },
  (v: OperationContract) => { v.pinnedSchema.revision = "main"; },
  (v: OperationContract) => { v.sources[0].file = "../escape"; },
  (v: OperationContract) => { v.documents[0].source = "query { missing }"; },
  (v: OperationContract) => { v.documents[0].file = "unknown.ts"; },
  (v: OperationContract) => { v.documents[0].line = 0; },
]) test(`rejects invalid contract ${change.toString()}`, () => { const v = structuredClone(contract); change(v); assert.throws(() => read(v)); });

test("binds candidate schema bytes, revision, dependencies and lockfile provenance", () => {
  const { sdl, manifest } = createSchemaContract(schema, revision, { graphql: "16.14.2", "@neo4j/graphql": "7.6.4", "neo4j-driver": "6.2.0" }, "lockfile");
  assert.equal(readSchema(sdl, manifest, revision).manifest.source.revision, revision);
  assert.throws(() => readSchema(sdl, manifest, "b".repeat(40)), /provenance/);
  assert.throws(() => readSchema(sdl + "\n", manifest, revision), /provenance/);
  const changed = JSON.parse(manifest); changed.files["schema.graphql"].bytes += 1;
  assert.throws(() => readSchema(sdl, JSON.stringify(changed), revision), /provenance/);
});
test("compatible additive candidate passes", () => assert.equal(compareSchemas(buildSchema("type Query { value: String! extra: Int }"), schema, contract).compatible, true));
test("incompatible field removal reports document and original location", () => {
  const result = compareSchemas(buildSchema("type Query { extra: Int }"), schema, contract);
  assert.equal(result.compatible, false);
  assert.match(result.diagnostics[0].message, /value/);
  assert.equal(result.diagnostics[0].file, "graphQLData/read.ts");
  assert.equal(result.diagnostics[0].line, 5);
  assert.equal(result.diagnostics[0].document, "Read");
  assert.ok(result.breakingChanges.length);
});
test("detects output nullability changes even with valid operations", () => {
  const result = compareSchemas(buildSchema("type Query { value: String }"), schema, contract);
  assert.equal(result.diagnostics.length, 0); assert.equal(result.compatible, false);
});
test("detects dangerous enum expansion outside selected fields", () => {
  const result = compareSchemas(buildSchema("enum Choice { A B } type Query { value: String! }"), buildSchema("enum Choice { A } type Query { value: String! }"), contract);
  assert.equal(result.compatible, false); assert.ok(result.dangerousChanges.length);
});
test("invalid syntax is an actionable rejection and fragment-only documents are supported", () => {
  const altered = structuredClone(contract); altered.documents[0].source = "bad graphql";
  assert.match(compareSchemas(schema, schema, altered).diagnostics[0].message, /Syntax Error/);
  altered.documents[0].source = "fragment Value on Query { value }";
  assert.equal(compareSchemas(schema, schema, altered).compatible, true);
});
test("publication jobs and schema upload depend on compatibility and persistence checks", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync(".github/workflows/container-image.yml", "utf8");
  assert.match(workflow, /build-publish:\n    needs: graphql-compatibility/);
  assert.match(workflow, /publish-smoke:[\s\S]*?needs: build-publish/);
  const gate = readFileSync(".github/workflows/graphql-compatibility.yml", "utf8");
  assert.ok(gate.indexOf("schema:compatibility") < gate.indexOf("Publish compatible"));
  assert.ok(gate.indexOf("test:frontend-contracts") < gate.indexOf("Publish compatible"));
  assert.doesNotMatch(gate, /secrets: inherit|pull_request_target|packages: write/);
});
