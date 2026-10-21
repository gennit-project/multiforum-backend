import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createCollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let repository: ReturnType<typeof createCollectionReadRepository>;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
  repository = createCollectionReadRepository(driver);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const outcome = async (call: () => Promise<unknown>) => call().then(value => ({value:plain(value)}), (error:Error) => ({error:error.message}));
// Baseline selections copied before migration; intentionally independent of repository documents.
const PROFILE_SELECTION = `{
        id
        name
        description
        visibility
        collectionType
        itemCount
        itemOrder
        createdAt
        updatedAt
        Channels {
          uniqueName
          displayName
          channelIconURL
        }
        Discussions {
          id
          title
        }
        Comments {
          id
          text
        }
        Downloads {
          id
          title
        }
        Images {
          id
          url
        }
      }`;
const selectionSetTemplate = `
{
  id
  name
  description
  visibility
  collectionType
  itemCount
  shareCount
  createdAt
  updatedAt
  itemOrder
  CreatedBy {
    username
    displayName
    profilePicURL
  }
  Downloads(options: { limit: 5 }__DISCUSSION_AGE_FILTER__) {
    id
    title
    createdAt
    hasSensitiveContent
    Album {
      id
      imageOrder
      Images__IMAGE_AGE_FILTER__ {
        id
        url
        caption
      }
    }
    DiscussionChannels {
      id
      channelUniqueName
      CommentsAggregate {
        count
      }
      Channel {
        uniqueName
        displayName
      }
    }
    Tags {
      text
    }
    Author {
      username
      displayName
      profilePicURL
      commentKarma
      discussionKarma
      createdAt
    }
  }
}
`;

const CLEAR_SOURCE_CONTENT_FILTER = "{ OR: [{ hasSensitiveContent: false }, { hasSensitiveContent: null }] }";

const legacyPublicSelection = (canViewSensitiveContent: boolean) =>
  selectionSetTemplate
    .replace(
      "__DISCUSSION_AGE_FILTER__",
      canViewSensitiveContent ? "" : `, where: ${CLEAR_SOURCE_CONTENT_FILTER}`
    )
    .replace(
      "__IMAGE_AGE_FILTER__",
      canViewSensitiveContent ? "" : `(where: ${CLEAR_SOURCE_CONTENT_FILTER})`
    );

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

test("profile collections preserve arbitrary filters, options and computed counts", async () => {
  await seed();
  for (const where of [{}, {CreatedBy:{username:'owner'}}, {OR:[{name_CONTAINS:'First'},{visibility:'PRIVATE'}]},
    {Downloads_SOME:{id:'clear'}}, {Channels_SOME:{uniqueName:'cats'}}, {NOT:{name:'Second'}}]) {
    for (const options of [{}, {sort:[]}, {sort:[{createdAt:'DESC'}],limit:1,offset:1}]) {
      const expected = await outcome(() => ogm.model("Collection").find({where:where as never,options:options as never,selectionSet:PROFILE_SELECTION}));
      assert.ok('value' in expected, JSON.stringify(expected));
      assert.deepEqual(await outcome(() => repository.findProfileCollections(where as never,options as never)),expected);
    }
  }
});

test("public collections preserve explicit sensitive filtering and anonymous schema authorization", async () => {
  await seed();
  const where = {visibility:'PUBLIC',Channels_SOME:{uniqueName:'cats'}};
  for (const mode of [false,true]) {
    const expected = await ogm.model('Collection').find({where:where as never,options:{sort:[{createdAt:'DESC' as never}]},selectionSet:legacyPublicSelection(mode)});
    const actual = await repository.findPublicContaining(where as never,mode);
    assert.deepEqual(plain(actual),plain(expected));
    // The production shared schema still has no outer JWT, even for an eligible caller.
    assert.deepEqual((actual[0].Downloads as Array<{id:string}>).map(row=>row.id),['clear']);
    const download = (actual[0].Downloads as Array<{Album:{Images:Array<{id:string}>}}>)[0];
    assert.deepEqual(download.Album.Images.map(row=>row.id),['image']);
  }
});

test("owned sharing snapshots retain ownership filter and narrow projections", async () => {
  await seed();
  for (const username of ['owner','stranger']) {
    const expected = await ogm.model('Collection').find({where:{id:'first',CreatedBy:{username}},selectionSet:'{id name description visibility CreatedBy {username}}'});
    assert.deepEqual(plain(await repository.findOwnedShareTarget('first',username)),plain(expected));
  }
  for (const uniqueName of ['cats','missing']) {
    assert.deepEqual(plain(await repository.findShareChannel(uniqueName)),plain(await ogm.model('Channel').find({where:{uniqueName},selectionSet:'{uniqueName}'})));
  }
  await driver.executeQuery("MATCH (c:Collection {id:'first'}) SET c.collectionType = 'INVALID'");
  assert.equal((await repository.findOwnedShareTarget('first','owner')).length,1);
});

test("filter and options validation preserve original first errors", async () => {
  for (const [where,options] of [[{unknown:'field'},{}],[{visibility:'invalid'},{}],[{}, {limit:'bad'}],[{}, {sort:[{unknown:'ASC'}]}]]) {
    const expected = await outcome(()=>ogm.model('Collection').find({where:where as never,options:options as never,selectionSet:PROFILE_SELECTION}));
    assert.ok('error' in expected);
    assert.deepEqual(await outcome(()=>repository.findProfileCollections(where as never,options as never)),expected);
  }
});

test("malformed selected enum and mandatory creator retain failures", async () => {
  await seed();
  await driver.executeQuery("MATCH (c:Collection {id:'first'}) SET c.visibility = 'INVALID'");
  const selectionSet = '{id name description visibility CreatedBy {username}}';
  const expected = await outcome(()=>ogm.model('Collection').find({where:{id:'first',CreatedBy:{username:'owner'}},selectionSet}));
  assert.ok('error' in expected);
  assert.deepEqual(await outcome(()=>repository.findOwnedShareTarget('first','owner')),expected);
  await driver.executeQuery("MATCH (c:Collection {id:'first'})-[r:CREATED_BY]->() SET c.visibility='PUBLIC' DELETE r");
  const publicExpected=await outcome(()=>ogm.model('Collection').find({where:{id:'first'},options:{sort:[{createdAt:'DESC' as never}]},selectionSet:legacyPublicSelection(false)}));
  assert.ok('error' in publicExpected);
  assert.deepEqual(await outcome(()=>repository.findPublicContaining({id:'first'},false)),publicExpected);
});

test("collections remain unbounded at root and public downloads retain limit five", async () => {
  await seed();
  await driver.executeQuery(`MATCH (owner:User {username:'owner'}) UNWIND range(1,30) AS i
    CREATE (c:Collection {id:'extra-'+toString(i),name:'Extra',visibility:'PUBLIC',collectionType:'DOWNLOADS',itemOrder:[],createdAt:datetime(),updatedAt:datetime()})
    CREATE (c)-[:CREATED_BY]->(owner)`);
  assert.equal((await repository.findProfileCollections({},{})).length,32);
  await driver.executeQuery(`MATCH (c:Collection {id:'first'}) UNWIND range(1,10) AS i
    CREATE (d:Discussion {id:'download-'+toString(i),title:'Download',createdAt:datetime()}) CREATE (c)-[:CONTAINS_DOWNLOAD]->(d)`);
  const actual = await repository.findPublicContaining({id:'first'},false);
  assert.equal((actual[0].Downloads as unknown[]).length,5);
  assert.deepEqual(plain(actual),plain(await ogm.model('Collection').find({where:{id:'first'},options:{sort:[{createdAt:'DESC' as never}]},selectionSet:legacyPublicSelection(false)})));
});
