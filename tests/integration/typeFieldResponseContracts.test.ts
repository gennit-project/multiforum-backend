import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { decodeDetailCollectionCursor } from "../../services/detailCollectionCursor.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => resetDatabase(driver));
// Feed the real composed field resolver a controlled parent through the real
// augmented query field. Only the root data source is replaced; GraphQL resolves
// and serializes the actual object/union fields and their generated nullability.
async function execute(root: string, fields: string, parents: unknown[], context: Record<string, unknown> = {}) {
  const field = schema.getQueryType()!.getFields()[root];
  const original = field.resolve;
  field.resolve = () => parents;
  try {
    return await graphql({ schema, source: `{ result:${root}{ ${fields} } }`, contextValue: { driver, req: { headers: {} }, ...context } });
  } finally { field.resolve = original; }
}
function output(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data)).result;
}
for (const [root, field, collection, flag, kind] of [
  ["albums", "detailImagesPageInfo", "Images", "_detailImagesHasNextPage", "image"],
  ["discussions", "detailFilesPageInfo", "DownloadableFiles", "_detailFilesHasNextPage", "file"],
  ["discussionChannels", "detailAnswersPageInfo", "Answers", "_detailAnswersHasNextPage", "answer"],
] as const) {
  test(`${field}: empty/missing collections and strict Boolean next-page flag serialize`, async () => {
    const result = output(await execute(root, `${field}{endCursor hasNextPage}`, [{}, { [collection]: [], [flag]: true }, { [collection]: null, [flag]: 1 }]));
    assert.deepEqual(result, [
      { [field]: { endCursor: null, hasNextPage: false } },
      { [field]: { endCursor: null, hasNextPage: true } },
      { [field]: { endCursor: null, hasNextPage: false } },
    ]);
  });
  test(`${field}: cursor uses the last item in existing order and missing keys remain nullable`, async () => {
    const result = output(await execute(root, `${field}{endCursor hasNextPage}`, [
      { [collection]: [{ id: "first", createdAt: "2026-01-01" }, { id: "last", createdAt: "2026-01-02" }], [flag]: true },
      { [collection]: [{ id: "id-only" }] }, { [collection]: [{ createdAt: "2026-01-01" }] },
    ]));
    assert.deepEqual(decodeDetailCollectionCursor({ after: result[0][field].endCursor, expectedKind: kind }), { id: "last", createdAt: "2026-01-02", kind });
    assert.equal(result[0][field].hasNextPage, true);
    assert.equal(result[1][field].endCursor, null); assert.equal(result[2][field].endCursor, null);
  });
}
for (const [root, field] of [["comments", "CommentAuthor"], ["issues", "Author"]] as const) {
  test(`${field}: username takes precedence, displayName selects moderator, fallback remains User`, async () => {
    const result = output(await execute(root, `${field}{__typename ... on User {username} ... on ModerationProfile {displayName}}`, [
      { [field]: { username: "person", displayName: "Both" } }, { [field]: { displayName: "Moderator" } }, { [field]: null },
    ]));
    assert.deepEqual(result, [
      { [field]: { __typename: "User", username: "person" } },
      { [field]: { __typename: "ModerationProfile", displayName: "Moderator" } },
      { [field]: null },
    ]);
    const fallback = output(await execute(root, `${field}{__typename}`, [{ [field]: {} }]));
    assert.deepEqual(fallback, [{ [field]: { __typename: "User" } }]);
    const malformed = await execute(root, `${field}{... on User {username}}`, [{ [field]: {} }]);
    assert.match(malformed.errors?.[0].message ?? "", /Cannot return null for non-nullable field User.username/);
  });
}
test("DownloadableFile.url serializes decoded owner access and anonymous denial", async () => {
  await driver.executeQuery("CREATE (:DownloadableFile {id:'file',uploadedByUsername:'owner',scanStatus:'CLEAN'})");
  const parent = [{ id: "file", url: "https://example.test/parent-file" }];
  const user = { username: "owner", email: null, email_verified: true, data: null };
  assert.deepEqual(output(await execute("downloadableFiles", "url", parent, { user })), [{ url: parent[0].url }]);
  assert.deepEqual(output(await execute("downloadableFiles", "url", parent)), [{ url: "" }]);
  assert.deepEqual(output(await execute("downloadableFiles", "url", [{ id: "missing", url: parent[0].url }], { user })), [{ url: "" }]);
});
test("DownloadableFile.url preserves malformed projection and read errors through GraphQL", async () => {
  const user = { username: "owner", email: null, email_verified: true, data: null };
  await driver.executeQuery("CREATE (:DownloadableFile {id:'file',uploadedByUsername:'owner',scanStatus:'invalid'})");
  const result = await execute("downloadableFiles", "url", [{ id: "file" }], { user });
  assert.match(result.errors?.[0].message ?? "", /Enum.*cannot represent/);
  const failed = await execute("downloadableFiles", "url", [{ id: "file" }], { user, downloadableFileRepository: { findUrlAccess: async () => { throw new Error("injected URL read failure"); } } });
  assert.match(failed.errors?.[0].message ?? "", /injected URL read failure/);
});
for (const [root, direct, variant] of [["images", "list80Url", "list80"], ["users", "avatar32Url", "avatar32"], ["channels", "icon32Url", "avatar32"]] as const) {
  test(`${root}.variantUrls: validated strings merge with direct values overriding stored JSON`, async () => {
    const result = output(await execute(root, "variantUrls", [
      { variantUrls: { [variant]: "stored", other: "kept", empty: " ", invalid: 1 }, [direct]: "direct" },
      { variantUrls: null, [direct]: " " },
    ]));
    assert.deepEqual(result, [{ variantUrls: { [variant]: "direct", other: "kept" } }, { variantUrls: null }]);
  });
}
test("opaque list fallback filters only null and leaves item serialization to GraphQL", async () => {
  assert.deepEqual(output(await execute("albums", "Images{id}", [{ Images: [null, { id: "image" }] }, { Images: null }])), [{ Images: [{ id: "image" }] }, { Images: [] }]);
  const malformed = await execute("albums", "Images{id}", [{ Images: [undefined] }]);
  assert.ok(malformed.errors);
});
test("JSON scalar retains arbitrary JSON values, outside generated structural certification", async () => {
  assert.deepEqual(output(await execute("comments", "emoji", [{ emoji: { arbitrary: [1, false, null] } }, { emoji: "encoded-string" }])), [{ emoji: { arbitrary: [1, false, null] } }, { emoji: "encoded-string" }]);
});

test("User.Collections serializes owner/private and visitor/public selections with empty relationships", async () => {
  await driver.executeQuery(`CREATE (u:User {username:'owner'}),
    (a:Collection {id:'public',name:'Public',visibility:'PUBLIC',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime(),updatedAt:datetime()}),
    (b:Collection {id:'private',name:'Private',visibility:'PRIVATE',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime(),updatedAt:datetime()})
    CREATE (a)-[:CREATED_BY]->(u), (b)-[:CREATED_BY]->(u)`);
  const fields = "Collections{id name visibility collectionType itemOrder Channels{uniqueName} Discussions{id} Comments{id} Downloads{id} Images{id}}";
  const user = { username: "owner", email: null, email_verified: true, data: null };
  const owner = output(await execute("users", fields, [{ username: "owner" }], { user }));
  assert.deepEqual(owner[0].Collections.map((c: { id: string }) => c.id).sort(), ["private", "public"]);
  for (const row of owner[0].Collections) for (const field of ["itemOrder", "Channels", "Discussions", "Comments", "Downloads", "Images"]) assert.deepEqual(row[field], []);
  const visitor = output(await execute("users", fields, [{ username: "owner" }]));
  assert.deepEqual(visitor[0].Collections.map((c: { id: string }) => c.id), ["public"]);
  await driver.executeQuery("MATCH(c:Collection {id:'public'}) SET c.visibility='INVALID'");
  const malformed = await execute("users", fields, [{ username: "owner" }], { user });
  assert.ok(malformed.errors);
});
