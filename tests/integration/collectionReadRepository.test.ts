import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createCollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let repository: ReturnType<typeof createCollectionReadRepository>;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
  repository = createCollectionReadRepository(driver);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
// Nested relationship projections come back via Cypher collect(), whose ordering is not
// The seed assigns some createdAt/updatedAt via datetime() (wall clock), so replace temporal
// fields with a placeholder and deep-sort before snapshotting for determinism.
const TIME_KEYS = new Set(["createdAt", "updatedAt", "timestamp"]);
const norm = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (TIME_KEYS.has(key) && v !== null ? "<time>" : v)));
const outcome = async (call: () => Promise<unknown>) => call().then(value => ({value:plain(value)}), (error:Error) => ({error:error.message}));

const seed = () => driver.executeQuery(`
  CREATE (owner:User {username:'owner', createdAt: datetime()})
  CREATE (channel:Channel {uniqueName:'cats'})
  CREATE (first:Collection {id:'first',name:'First',visibility:'PUBLIC',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime('2026-01-01T00:00:00Z'),updatedAt:datetime()})
  CREATE (second:Collection {id:'second',name:'Second',visibility:'PRIVATE',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime('2026-02-01T00:00:00Z'),updatedAt:datetime()})
  CREATE (first)-[:CREATED_BY]->(owner), (second)-[:CREATED_BY]->(owner)
  CREATE (first)-[:CONTAINS_CHANNEL]->(channel)
  CREATE (clear:Discussion {id:'clear',title:'Clear',hasDownload:true,createdAt:datetime()})
  CREATE (sensitive:Discussion {id:'sensitive',title:'Sensitive',hasDownload:true,hasSensitiveContent:true,createdAt:datetime()})
  CREATE (first)-[:CONTAINS_DOWNLOAD]->(clear), (first)-[:CONTAINS_DOWNLOAD]->(sensitive)
  CREATE (owner)-[:POSTED_DISCUSSION]->(clear), (owner)-[:POSTED_DISCUSSION]->(sensitive)
  CREATE (album:Album {id:'album',imageOrder:[]})
  CREATE (clear)-[:HAS_ALBUM]->(album)
  CREATE (image:Image {id:'image',url:'https://example.test/image',scanStatus:'PENDING'})
  CREATE (hiddenImage:Image {id:'hidden-image',url:'https://example.test/hidden',hasSensitiveContent:true,scanStatus:'PENDING'})
  CREATE (album)-[:HAS_IMAGE]->(image), (album)-[:HAS_IMAGE]->(hiddenImage)
`);

test("profile collections preserve arbitrary filters, options and computed counts", async (t) => {
  await seed();
  for (const where of [{}, {CreatedBy:{username:'owner'}}, {OR:[{name_CONTAINS:'First'},{visibility:'PRIVATE'}]},
    {Downloads_SOME:{id:'clear'}}, {Channels_SOME:{uniqueName:'cats'}}, {NOT:{name:'Second'}}]) {
    for (const options of [{}, {sort:[]}, {sort:[{createdAt:'DESC'}],limit:1,offset:1}]) {
      const actual = await outcome(() => repository.findProfileCollections(where as never,options as never));
      assert.ok('value' in actual, JSON.stringify(actual));
      t.assert.snapshot(norm(actual));
    }
  }
});

test("public collections preserve explicit sensitive filtering and anonymous schema authorization", async (t) => {
  await seed();
  const where = {visibility:'PUBLIC',Channels_SOME:{uniqueName:'cats'}};
  for (const mode of [false,true]) {
    const actual = await repository.findPublicContaining(where as never,mode);
    t.assert.snapshot(norm(actual));
    // The caller's resolved age-gate eligibility is conveyed as the jwt, so an
    // eligible caller (mode=true) sees sensitive rows and an ineligible one does
    // not — the generated read's @authorization agrees with the caller's decision.
    assert.deepEqual((actual[0].Downloads as Array<{id:string}>).map(row=>row.id).sort(), mode?['clear','sensitive']:['clear']);
    const download = (actual[0].Downloads as Array<{id:string;Album:{Images:Array<{id:string}>}}>).find(row=>row.id==='clear')!;
    assert.deepEqual(download.Album.Images.map(row=>row.id).sort(), mode?['hidden-image','image']:['image']);
  }
});

test("owned sharing snapshots retain ownership filter and narrow projections", async (t) => {
  await seed();
  for (const username of ['owner','stranger']) {
    t.assert.snapshot(norm(await repository.findOwnedShareTarget('first',username)));
  }
  for (const uniqueName of ['cats','missing']) {
    t.assert.snapshot(norm(await repository.findShareChannel(uniqueName)));
  }
  await driver.executeQuery("MATCH (c:Collection {id:'first'}) SET c.collectionType = 'INVALID'");
  assert.equal((await repository.findOwnedShareTarget('first','owner')).length,1);
});

test("filter and options validation preserve original first errors", async () => {
  const cases:[any,any,RegExp][]=[[{unknown:'field'},{},/Field "unknown" is not defined by type "CollectionWhere"/],[{visibility:'invalid'},{},/does not exist in/],[{}, {limit:'bad'},/Int cannot represent non-integer value/],[{}, {sort:[{unknown:'ASC'}]},/Field "unknown" is not defined by type/]];
  for (const [where,options,message] of cases) {
    await assert.rejects(repository.findProfileCollections(where as never,options as never), message);
  }
});

test("malformed selected enum and mandatory creator retain failures", async () => {
  await seed();
  await driver.executeQuery("MATCH (c:Collection {id:'first'}) SET c.visibility = 'INVALID'");
  await assert.rejects(repository.findOwnedShareTarget('first','owner'), /cannot represent value/);
  await driver.executeQuery("MATCH (c:Collection {id:'first'})-[r:CREATED_BY]->() SET c.visibility='PUBLIC' DELETE r");
  await assert.rejects(repository.findPublicContaining({id:{eq:'first'}},false), /Cannot return null for non-nullable field Collection\.CreatedBy/);
});

test("collections remain unbounded at root and public downloads retain limit five", async (t) => {
  await seed();
  await driver.executeQuery(`MATCH (owner:User {username:'owner'}) UNWIND range(1,30) AS i
    CREATE (c:Collection {id:'extra-'+toString(i),name:'Extra',visibility:'PUBLIC',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime(),updatedAt:datetime()})
    CREATE (c)-[:CREATED_BY]->(owner)`);
  assert.equal((await repository.findProfileCollections({},{})).length,32);
  await driver.executeQuery(`MATCH (c:Collection {id:'first'}) UNWIND range(1,10) AS i
    CREATE (d:Discussion {id:'download-'+toString(i),title:'Download',createdAt:datetime()}) CREATE (c)-[:CONTAINS_DOWNLOAD]->(d)`);
  const actual = await repository.findPublicContaining({id:{eq:'first'}},false);
  assert.equal((actual[0].Downloads as unknown[]).length,5);
  // The Downloads projection applies limit 5; which 5 of the eligible downloads are returned
  // is only stable within a single run, so snapshot the projection with Downloads reduced to a count.
  t.assert.snapshot(norm(plain(actual).map((row: Record<string, unknown>) => ({ ...row, Downloads: (row.Downloads as unknown[]).length }))));
});
