import assert from "node:assert/strict";
import test from "node:test";
import { buildSchema, isInputObjectType, printSchema } from "graphql";
import { buildPublicSchema } from "./publicSchema.js";
import { createSchemaContract, sha256 } from "./schemaContract.js";

const revision = "a".repeat(40);
const schema = buildSchema(`
  type Query { hello: String }
  input LegacyFilter { old: String @deprecated(reason: "Use eq") eq: String }
`);
const dependencies = { graphql: "16.14.2" };

test("contract contains exact byte checksums and full source provenance", () => {
  const contract = createSchemaContract(schema, revision, dependencies, "lockfile");
  const manifest = JSON.parse(contract.manifest);
  assert.deepEqual(manifest, {
    formatVersion: 1,
    source: { repository: "gennit-project/multiforum-backend", revision },
    dependencies,
    lockfileSha256: sha256("lockfile"),
    files: { "schema.graphql": {
      sha256: sha256(contract.sdl), bytes: Buffer.byteLength(contract.sdl),
    } },
  });
});

test("export is deterministic and retains deprecated input definitions", () => {
  const first = createSchemaContract(schema, revision, dependencies, "lockfile");
  const second = createSchemaContract(schema, revision, dependencies, "lockfile");
  assert.deepEqual(second, first);
  assert.match(first.sdl, /old: String @deprecated/);
});

test("an abbreviated or invalid source revision cannot label a contract", () => {
  for (const invalid of ["main", "1234567", "", "z".repeat(40)]) {
    assert.throws(() => createSchemaContract(schema, invalid, dependencies, "lockfile"), /full Git commit/);
  }
});

test("public schema builds without a driver and SDL retains its API surface", { timeout: 60000 }, async () => {
  const publicSchema = await buildPublicSchema();
  const sdl = createSchemaContract(publicSchema, revision, dependencies, "lockfile").sdl;
  assert.equal(printSchema(buildSchema(sdl)), printSchema(publicSchema));
  assert.ok(publicSchema.getQueryType()?.getFields().getDiscussionDetail);
  assert.ok(publicSchema.getMutationType()?.getFields().createUsers);
  const userWhere = publicSchema.getType("UserWhere");
  assert.ok(isInputObjectType(userWhere));
  assert.ok(userWhere.getFields().username_EQ?.deprecationReason);
});
