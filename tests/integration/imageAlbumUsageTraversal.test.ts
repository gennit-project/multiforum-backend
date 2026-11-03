import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

// Real application query and Shield permissions; no external services or storage.
let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema();
  schema = applyMiddleware(raw, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (alice:User {username:'alice',displayName:'Alice'})
    CREATE (bob:User {username:'bob',displayName:'Bob'})
    CREATE (image:Image {id:'image',createdAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (alice)-[:UPLOADED_IMAGE]->(image)
    CREATE (alice)-[:HAS_ALBUM]->(owned:Album {id:'owned',imageOrder:['image','second']})
    CREATE (bob)-[:HAS_ALBUM]->(other:Album {id:'other',imageOrder:['image']})
    CREATE (owned)-[:HAS_IMAGE]->(image) CREATE (other)-[:HAS_IMAGE]->(image)
    CREATE (alice)-[:POSTED_DISCUSSION]->(discussion:Discussion {id:'discussion',title:'Title',createdAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (discussion)-[:HAS_ALBUM]->(owned)
    CREATE (post:DiscussionChannel {id:'post',channelUniqueName:'forum'})-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (post)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName:'forum'})
  `);
});
const query = `query {
  usage:getImageAlbumUsage(imageId:"image") {
    imageId uploaderUsername
    uploaderOwnedAlbums { ...AlbumUsage }
    otherAlbums { ...AlbumUsage }
  }
}
fragment AlbumUsage on Album {
  id imageOrder Owner { username displayName }
  Discussions { id title Author { username } forums:DiscussionChannels { id channelUniqueName } }
}`;
function execute(source = query, sensitive = false) {
  return graphql({ schema, source, contextValue: { driver, req: { headers: {} }, mayAccessSensitiveContent: sensitive } });
}
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data)).usage;
}

test("public usage follows canonical forum edges through aliases/fragments and preserves ownership groups", async () => {
  const usage = data(await execute());
  assert.deepEqual(usage, {
    imageId: "image", uploaderUsername: "alice",
    uploaderOwnedAlbums: [{
      id: "owned",
      imageOrder: ["image", "second"],
      Owner: { username: "alice", displayName: "Alice" },
      Discussions: [{
        id: "discussion",
        title: "Title",
        Author: { username: "alice" },
        forums: [{ id: "post", channelUniqueName: "forum" }],
      }],
    }],
    otherAlbums: [{ id: "other", imageOrder: ["image"], Owner: { username: "bob", displayName: "Bob" }, Discussions: [] }],
  });
});

test("multiple forums are included once and reversed edges are ignored without duplicating albums or discussions", async () => {
  await driver.executeQuery(`MATCH (d:Discussion {id:'discussion'}),(post:DiscussionChannel {id:'post'})
    CREATE (post)-[:POSTED_IN_CHANNEL]->(d)
    CREATE (second:DiscussionChannel {id:'second-post',channelUniqueName:'second-forum'})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (second)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName:'second-forum'})
    CREATE (d)-[:POSTED_IN_CHANNEL]->(:DiscussionChannel {id:'wrong-way',channelUniqueName:'decoy'})`);
  const usage = data(await execute());
  assert.equal(usage.uploaderOwnedAlbums.length, 1);
  assert.equal(usage.otherAlbums.length, 1);
  assert.equal(usage.uploaderOwnedAlbums[0].Discussions.length, 1);
  assert.deepEqual(usage.uploaderOwnedAlbums[0].Discussions[0].forums.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), [
    { id: "post", channelUniqueName: "forum" }, { id: "second-post", channelUniqueName: "second-forum" },
  ]);
});

test("missing forum and author relationships remain empty/null", async () => {
  await driver.executeQuery("MATCH ()-[r:POSTED_IN_CHANNEL|POSTED_DISCUSSION]->(:Discussion {id:'discussion'}) DELETE r");
  const discussion = data(await execute()).uploaderOwnedAlbums[0].Discussions[0];
  assert.deepEqual(discussion.forums, []);
  assert.equal(discussion.Author, null);
});

test("missing uploader and owner retain other-album grouping without invented identities", async () => {
  await driver.executeQuery("MATCH (:User)-[r:UPLOADED_IMAGE]->(:Image {id:'image'}) DELETE r");
  await driver.executeQuery("MATCH (:User)-[r:HAS_ALBUM]->(:Album {id:'other'}) DELETE r");
  const usage = data(await execute());
  assert.equal(usage.uploaderUsername, null);
  assert.deepEqual(usage.uploaderOwnedAlbums, []);
  assert.deepEqual(usage.otherAlbums.map((a: { id: string }) => a.id).sort(), ["other", "owned"]);
  assert.equal(usage.otherAlbums.find((a: { id: string }) => a.id === "other").Owner, null);
});

test("image with no album usage returns empty groups", async () => {
  await driver.executeQuery("MATCH (:Album)-[r:HAS_IMAGE]->(:Image {id:'image'}) DELETE r");
  const usage = data(await execute());
  assert.deepEqual(usage.uploaderOwnedAlbums, []);
  assert.deepEqual(usage.otherAlbums, []);
});

for (const property of ["archived", "permanentlyRemoved", "hasSensitiveContent"]) {
  test(`${property} image is hidden from an ineligible public caller`, async () => {
    await driver.executeQuery(`MATCH (i:Image {id:'image'}) SET i.${property} = true`);
    const result = await execute();
    assert.match(result.errors?.[0].message ?? "", /Image not found/);
    assert.equal(result.data, null);
    if (property === "hasSensitiveContent") assert.equal(data(await execute(query, true)).imageId, "image");
  });
}

test("sensitive discussion and its forums remain hidden unless age access permits them", async () => {
  await driver.executeQuery("MATCH (d:Discussion {id:'discussion'}) SET d.hasSensitiveContent = true");
  assert.deepEqual(data(await execute()).uploaderOwnedAlbums[0].Discussions, []);
  assert.deepEqual(data(await execute(query, true)).uploaderOwnedAlbums[0].Discussions[0].forums, [{ id: "post", channelUniqueName: "forum" }]);
});

test("private owner fields remain denied through nested album usage", async () => {
  const result = await execute('{usage:getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Owner{username private:stripeAccountId}}}}');
  assert.match(result.errors?.[0].message ?? "", /You must be the owner of this account/);
  assert.deepEqual(result.errors?.[0].path, ["usage", "uploaderOwnedAlbums", 0, "Owner", "private"]);
});

test("missing images retain the explicit not-found error", async () => {
  const result = await execute(query.replace('imageId:"image"', 'imageId:"missing"'));
  assert.match(result.errors?.[0].message ?? "", /Image not found/);
  assert.equal(result.data, null);
});
