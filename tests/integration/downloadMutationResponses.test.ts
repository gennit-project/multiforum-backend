import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import { applyMiddleware } from "graphql-middleware";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import typeDefs from "../../typeDefs.js";
import getStoredUploadDeleteResolver from "../../customResolvers/mutations/permanentlyDeleteStoredUpload.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { deleteStoredObject } from "../../services/storageDeletion.js";
import {
  mockToken, modContext, resetDb, run, startImageModEnv, stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";

// Real executable schema, application resolvers and disposable persistence.
// Only the external storage client is fake. Resolver-level authorization is real;
// application-wide Shield wiring has separate coverage in the auth suite.
let env: ImageModEnv;
let schema: GraphQLSchema;
let deletedObjects: string[];
let storageError: Error | undefined;
before(async () => {
  env = await startImageModEnv();
  schema = await new Neo4jGraphQL({
    driver: env.driver, typeDefs,
    resolvers: {
      ...env.resolvers,
      Mutation: {
        ...env.resolvers.Mutation,
        permanentlyDeleteDownloadableFile: getStoredUploadDeleteResolver({
          driver: env.driver, mediaType: "DownloadableFile",
          deleteObject: (input) => deleteStoredObject({
            ...input,
            storage: { bucket: (bucket) => {
              assert.equal(bucket, "fixture");
              return { file: (object) => ({ delete: async (options) => {
                assert.deepEqual(options, { ignoreNotFound: true });
                if (storageError) throw storageError;
                deletedObjects.push(object);
              } }) };
            } },
          }),
        }),
      },
    },
    features: { filters: { String: { MATCHES: true } } },
  }).getSchema();
  registerGeneratedSchema(env.driver, schema);
  schema=applyMiddleware(schema,sourceIdentity);
}, { timeout: 240000 });
after(async () => stopImageModEnv());
beforeEach(async () => {
  await resetDb();
  deletedObjects = [];
  storageError = undefined;
  await run(`
    CREATE (:User {username: 'alice'})
    CREATE (:User {username: 'bob'})
    CREATE (:UploadedFileAudit {
      id: 'audit', storageBucket: 'fixture', storageObjectName: 'uploads/alice/file.zip',
      storageUrl: 'https://example.invalid/file.zip', originalFilename: 'file.zip',
      contentType: 'application/zip', uploadedAt: datetime('2026-01-01T00:00:00Z'),
      uploadedByUsername: 'alice'
    })
  `);
});
const execute = (source: string, username = "alice") => graphql({
  schema, source,
  contextValue: modContext(env, mockToken({ username, email: `${username}@example.com` })),
});
const create = (selection: string, input = `[{fileName:"file.zip",kind:ZIP,url:"https://example.invalid/file.zip",storageObjectName:"uploads/alice/file.zip"}]`) =>
  `mutation { createDownloadableFiles(input:${input}) { ${selection} } }`;
const remove = (selection = "id createdAt priceModel scanStatus permanentlyRemoved") =>
  `mutation { permanentlyDeleteDownloadableFile(downloadableFileId:"file") { ${selection} } }`;
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function assertCreatedAndClaimed() {
  const rows = await run(`MATCH (f:DownloadableFile), (a:UploadedFileAudit {id:'audit'})
    RETURN f.id AS id, a.claimedById AS claimedById, a.claimedByType AS claimedByType`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].claimedById, rows[0].id);
  assert.equal(rows[0].claimedByType, "DownloadableFile");
}
async function seedFile() {
  await run(`CREATE (:DownloadableFile {
    id:'file', fileName:'file.zip', kind:'ZIP', size:42, url:'https://example.invalid/file.zip',
    storageBucket:'fixture', storageObjectName:'uploads/alice/file.zip',
    uploadedByUsername:'alice', uploadedByIp:'192.0.2.1',
    uploadedAt:datetime('2025-12-31T23:00:00Z'), createdAt:datetime('2026-01-01T00:00:00Z'),
    priceModel:'FIXED', priceCents:123, priceCurrency:'EUR', scanStatus:'CLEAN',
    scanReason:'fixture clean', downloadCountTotal:7, downloadCountUnique:3,
    attributionOverride:'Original author', supportKoFiUrl:'https://ko-fi.com/fixture',
    paywallExpiresAt:datetime('2027-01-01T00:00:00Z'), stripeProductId:'product-fixture',
    stripePriceId:'price-fixture', scanCheckedAt:datetime('2026-01-02T00:00:00Z'),
    reviewRequestedAt:datetime('2026-01-03T00:00:00Z'), reviewRequestReason:'fixture review',
    reviewRequestedByUsername:'alice'
  })`);
}
async function assertDeleted() {
  assert.deepEqual(deletedObjects, ["uploads/alice/file.zip"]);
  const rows = await run(`MATCH (f:DownloadableFile {id:'file'})
    RETURN f.permanentlyRemoved AS removed, f.permanentlyRemovedByUsername AS actor,
    EXISTS { MATCH (:User {username:'alice'})-[:REMOVED_DOWNLOADABLE_FILE]->(f) } AS linked`);
  assert.deepEqual(rows, [{ removed: true, actor: "alice", linked: true }]);
}
async function assertNotRemoved() {
  const rows = await run(`MATCH (f:DownloadableFile {id:'file'})
    RETURN f.permanentlyRemoved AS removed,
    EXISTS { MATCH ()-[:REMOVED_DOWNLOADABLE_FILE]->(f) } AS linked`);
  assert.deepEqual(rows, [{ removed: null, linked: false }]);
}

test("creation returns required info and file data after claiming the audit", async () => {
  const result = await execute(create("downloadableFiles { id fileName kind createdAt priceModel scanStatus } info { nodesCreated relationshipsCreated }"));
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(plain((result.data?.createDownloadableFiles as { info: unknown }).info), { nodesCreated: 1, relationshipsCreated: 0 });
  await assertCreatedAndClaimed();
});

test("info-only selection still creates the file and claims the audit", async () => {
  const result = await execute(create("info { nodesCreated relationshipsCreated }"));
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(plain(result.data), { createDownloadableFiles: { info: { nodesCreated: 1, relationshipsCreated: 0 } } });
  await assertCreatedAndClaimed();
});

for (const count of [0, 2]) {
  test(`creation counters reflect ${count} actual files with no fabricated relationships`, async () => {
    const input = Array.from({ length: count }, (_, i) => `{fileName:"${i}.zip",kind:ZIP,url:"https://example.invalid/${i}.zip"}`).join(",");
    const result = await execute(create("info { nodesCreated relationshipsCreated } downloadableFiles { id }", `[${input}]`));
    assert.equal(result.errors, undefined, JSON.stringify(result.errors));
    const response = result.data?.createDownloadableFiles as { info: unknown; downloadableFiles: unknown[] };
    assert.deepEqual(plain(response.info), { nodesCreated: count, relationshipsCreated: 0 });
    assert.equal(response.downloadableFiles.length, count);
    assert.equal((await run("MATCH (f:DownloadableFile) RETURN f.id AS id")).length, count);
  });
}

test("unverified audit and anonymous creation return errors without creating files or claiming audits", async () => {
  for (const username of ["bob", ""]) {
    const result = await execute(create("info { nodesCreated }"), username);
    assert.ok(result.errors?.length);
    assert.equal(result.data, null);
  }
  assert.deepEqual(await run("MATCH (f:DownloadableFile) RETURN f.id AS id"), []);
  assert.deepEqual(await run("MATCH (a:UploadedFileAudit) RETURN a.claimedById AS claimedById"), [{ claimedById: null }]);
});

test("database creation failure rolls back and never returns success info or claims the audit", async () => {
  // A real Cypher datetime conversion error exercises transaction rollback.
  await run("MATCH (a:UploadedFileAudit) SET a.uploadedAt = 'invalid'");
  const result = await execute(create("info { nodesCreated }"));
  assert.match(result.errors?.[0].message ?? "", /Failed to create downloadable files/);
  assert.equal(result.data, null);
  assert.deepEqual(await run("MATCH (f:DownloadableFile) RETURN f.id AS id"), []);
  assert.deepEqual(await run("MATCH (a:UploadedFileAudit) RETURN a.claimedById AS claimedById"), [{ claimedById: null }]);
});

test("deletion returns stored required and optional scalars, not invented defaults", async () => {
  await seedFile();
  const result = await execute(remove(`id fileName kind size createdAt priceModel priceCents priceCurrency
    uploadedAt uploadedByUsername uploadedByIp scanStatus scanReason scanCheckedAt
    downloadCountTotal downloadCountUnique attributionOverride supportKoFiUrl supportPatreonUrl
    paywallExpiresAt stripeProductId stripePriceId reviewRequestedAt reviewRequestReason
    reviewRequestedByUsername supportBuyMeACoffeeUrl supportPayPalMeUrl
    storageBucket storageObjectName storageUrl permanentlyRemovedByModName
    permanentlyRemoved permanentlyRemovedAt permanentlyRemovedByUsername`));
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const response = result.data?.permanentlyDeleteDownloadableFile as Record<string, unknown>;
  const stored = (await run(`MATCH (f:DownloadableFile {id:'file'}) RETURN f {.*} AS file`))[0].file;
  for (const [key, value] of Object.entries(response)) {
    const expected = stored[key];
    if (value != null && ["createdAt", "uploadedAt", "permanentlyRemovedAt", "scanCheckedAt", "paywallExpiresAt", "reviewRequestedAt"].includes(key)) {
      assert.equal(Date.parse(String(value)), Date.parse(String(expected)), key);
    } else {
      assert.equal(value == null ? value : String(value), expected == null ? null : String(expected), key);
    }
  }
  assert.equal(response.priceModel, "FIXED");
  assert.equal(response.priceCents, 123);
  await assertDeleted();
  const retry = await execute(remove());
  assert.match(retry.errors?.[0].message ?? "", /already been permanently deleted/);
  assert.deepEqual(plain(retry.data), { permanentlyDeleteDownloadableFile: null });
  await assertDeleted(); // No second storage operation.
});

test("unauthorized deletion performs no storage or persistence writes", async () => {
  await seedFile();
  const result = await execute(remove(), "bob");
  assert.ok(result.errors?.length);
  assert.deepEqual(plain(result.data), { permanentlyDeleteDownloadableFile: null });
  assert.deepEqual(deletedObjects, []);
  await assertNotRemoved();
});

test("storage failure returns an error and leaves removal state unchanged", async () => {
  await seedFile();
  storageError = new Error("fixture storage unavailable");
  const result = await execute(remove());
  assert.match(result.errors?.[0].message ?? "", /fixture storage unavailable/);
  assert.deepEqual(plain(result.data), { permanentlyDeleteDownloadableFile: null });
  assert.deepEqual(deletedObjects, []);
  await assertNotRemoved();
});

test("missing download returns an error without touching storage", async () => {
  const result = await execute(remove());
  assert.match(result.errors?.[0].message ?? "", /Downloadable file not found/);
  assert.deepEqual(plain(result.data), { permanentlyDeleteDownloadableFile: null });
  assert.deepEqual(deletedObjects, []);
});

test("persistence failure after storage deletion returns an error, never a successful removal", async () => {
  await seedFile();
  await run("CREATE (:DownloadableFile {id:'conflict', permanentlyRemovedByUsername:'alice'})");
  await run("CREATE CONSTRAINT download_response_remover_unique FOR (f:DownloadableFile) REQUIRE f.permanentlyRemovedByUsername IS UNIQUE");
  try {
    const result = await execute(remove());
    assert.ok(result.errors?.length);
    assert.deepEqual(plain(result.data), { permanentlyDeleteDownloadableFile: null });
    assert.deepEqual(deletedObjects, ["uploads/alice/file.zip"]);
    await assertNotRemoved();
  } finally {
    await run("DROP CONSTRAINT download_response_remover_unique");
  }
});

test("legacy download without storage metadata retains the existing skip-and-mark behavior", async () => {
  await seedFile();
  await run("MATCH (f:DownloadableFile {id:'file'}) REMOVE f.storageBucket, f.storageObjectName");
  const result = await execute(remove());
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal((result.data?.permanentlyDeleteDownloadableFile as { permanentlyRemoved: boolean }).permanentlyRemoved, true);
  assert.deepEqual(deletedObjects, []);
  assert.deepEqual(await run("MATCH (f:DownloadableFile {id:'file'}) RETURN f.permanentlyRemoved AS removed"), [{ removed: true }]);
});

test('download create envelope, counters and file identity preserve collisions',async()=>{
 const response=await execute(create('info:downloadableFiles{id:fileName fileName:id} downloadableFiles:info{nodesCreated:relationshipsCreated relationshipsCreated:nodesCreated}'));
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 const result=JSON.parse(JSON.stringify(response.data)).createDownloadableFiles;
 assert.equal(result.info[0].id,'file.zip');assert.equal(typeof result.info[0].fileName,'string');
 assert.deepEqual(result.downloadableFiles,{nodesCreated:0,relationshipsCreated:1});await assertCreatedAndClaimed();
});
test('stored download deletion preserves colliding native identity fields',async()=>{
 await seedFile();const response=await execute(remove('id:fileName fileName:id'));
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));assert.deepEqual(plain(response.data),{permanentlyDeleteDownloadableFile:{id:'file.zip',fileName:'file'}});await assertDeleted();
});
