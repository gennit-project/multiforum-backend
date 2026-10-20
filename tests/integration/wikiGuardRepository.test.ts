import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createWikiGuardRepository } from "../../services/persistence/wikiGuardRepository.js";
import { createOwnedChildWikiPages } from "../../middleware/wikiPageOwnershipMiddleware.js";
import type { GraphQLContext } from "../../types/context.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let repository: ReturnType<typeof createWikiGuardRepository>;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
  repository = createWikiGuardRepository(driver);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const seed = () => driver.executeQuery(`
  CREATE (cats:Channel {uniqueName:'cats'}), (dogs:Channel {uniqueName:'dogs'})
  CREATE (user:User {username:'author'})
  CREATE (a:WikiPage {id:'a',title:'Cat guide',locked:true})
  CREATE (b:WikiPage {id:'b',title:'Dog guide',locked:false})
  CREATE (cats)-[:OWNS_WIKI_PAGE]->(a), (dogs)-[:OWNS_WIKI_PAGE]->(b)
  CREATE (user)-[:AUTHORED_WIKI_PAGE]->(a)
  CREATE (a)-[:HAS_CHILD_PAGE]->(b)
`);
const methods = [
  ["findPermissionTargets", "{ id Channel { uniqueName } locked OriginalAuthor { username } ChildPages { id } }"],
  ["findChildCreationOwners", "{ Channel { uniqueName } }"],
] as const;
const outcome = async (call: () => Promise<unknown>) => call().then(value => ({ value: plain(value) }), (error: Error) => ({ error: error.message }));
for (const [method, selectionSet] of methods) {
  test(`${method}: arbitrary filters and default projection match production OGM`, async () => {
    await seed();
    for (const where of [undefined, null, {}, { id: "missing" },
      { OR: [{ id: "a" }, { title_CONTAINS: "Dog" }] },
      { AND: [{ title_MATCHES: ".*guide" }, { NOT: { locked: false } }] },
      { Channel: { uniqueName: "cats" } }, { OriginalAuthor: { username: "author" } },
      { ChildPages_SOME: { id: "b" } }, { id_IN: ["a", "b"] },
    ]) {
      const expected = await outcome(() => ogm.model("WikiPage").find({ where: where as never, selectionSet }));
      assert.ok("value" in expected, JSON.stringify(expected));
      assert.deepEqual(await outcome(() => repository[method](where)), expected);
    }
  });
  test(`${method}: malformed filters expose the same first generated error`, async () => {
    for (const where of [{ invented: "field" }, { id: {} }, { locked: "yes" }, { OR: [{ id: [] }] }]) {
      const expected = await outcome(() => ogm.model("WikiPage").find({ where: where as never, selectionSet }));
      assert.ok("error" in expected);
      assert.deepEqual(await outcome(() => repository[method](where)), expected);
    }
  });
  test(`${method}: root and child default limits stay at 25`, async () => {
    await driver.executeQuery(`CREATE (c:Channel {uniqueName:'cats'})
      WITH c UNWIND range(1,30) AS i CREATE (p:WikiPage {id:toString(i)}) CREATE (c)-[:OWNS_WIKI_PAGE]->(p)`);
    await driver.executeQuery(`MATCH (p:WikiPage {id:'1'}), (child:WikiPage) CREATE (p)-[:HAS_CHILD_PAGE]->(child)`);
    const actual = await repository[method]({});
    assert.equal(actual.length, 25);
    assert.deepEqual(plain(actual), plain(await ogm.model("WikiPage").find({ selectionSet })));
    if (method === "findPermissionTargets") {
      const roots = await repository.findPermissionTargets({ id: "1" });
      assert.equal(roots[0].ChildPages?.length, 25);
    }
  });
}

test("owner selection does not introduce validation of unselected lock/author/child fields", async () => {
  await seed();
  await driver.executeQuery("MATCH (p:WikiPage {id:'a'}) SET p.locked = 'invalid'");
  assert.deepEqual(plain(await repository.findChildCreationOwners({ id: "a" })), [{ Channel: { uniqueName: "cats" } }]);
  const selectionSet = methods[0][1];
  const expected = await outcome(() => ogm.model("WikiPage").find({ where: { id: "a" }, selectionSet }));
  assert.ok("error" in expected);
  assert.deepEqual(await outcome(() => repository.findPermissionTargets({ id: "a" })), expected);
});

test("owner middleware remains fail closed for empty or multi-channel matches", async () => {
  await seed();
  const ctx = { driver, ogm } as GraphQLContext;
  for (const where of [{ id: "missing" }, {}]) {
    await assert.rejects(createOwnedChildWikiPages(async () => assert.fail("must not write"), null,
      { where, update: { ChildPages: { create: [{ node: {} }] } } }, ctx, {} as never), /one channel owner/);
  }
  const result = await createOwnedChildWikiPages(async (_parent, args) => args, null,
    { where: { id: "a" }, update: { ChildPages: { create: [{ node: { title: "Child" } }] } } }, ctx, {} as never) as Record<string, any>;
  assert.equal(result.update.ChildPages.create[0].node.channelUniqueName, "cats");
});

test("missing mandatory Channel relation retains generated failure for both selections", async () => {
  await driver.executeQuery("CREATE (:WikiPage {id:'orphan'})");
  for (const [method, selectionSet] of methods) {
    const expected = await outcome(() => ogm.model("WikiPage").find({ where: { id: "orphan" }, selectionSet }));
    assert.ok("error" in expected);
    assert.deepEqual(await outcome(() => repository[method]({ id: "orphan" })), expected);
  }
});
