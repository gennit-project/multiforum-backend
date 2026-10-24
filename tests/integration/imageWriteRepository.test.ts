import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createImageCreationRepository,createProfileImageRepository,createChannelIconRepository} from '../../services/persistence/imageWriteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
import {denyImageExternalIo} from '../denyImageExternalIo.js';
let driver:Driver;let schema:GraphQLSchema;let guard:ReturnType<typeof denyImageExternalIo>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);guard=denyImageExternalIo();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{guard?.assertUnused();guard?.restore();await engine.close();await stopNeo4j();});
const normalize = (input: unknown) => {
 const ids = new Map<string, string>();
 return JSON.parse(JSON.stringify(input, function (key, value) {
  if (value && typeof value === 'object' && 'year' in value && 'nanosecond' in value) return '<generated-datetime>';
  if (['createdAt', 'uploadedAt', 'timestamp', 'updatedAt'].includes(key)) return '<time>';
  if (['id', 'id_from', 'id_to'].includes(key) && value) {
   // Neo4j node and relationship IDs have independent namespaces; neither is a domain ID.
   const namespace = typeof this.event === 'string'
    ? key === 'id' && this.event.includes('relationship') ? 'relationship' : 'node'
    : 'domain';
   const identity = `${namespace}:${typeof value}:${value}`;
   if (!ids.has(identity)) ids.set(identity, `${namespace}-${ids.size}`);
   return ids.get(identity);
  }
  return value;
 }));
};
const seed=async()=>driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime()}),(:Channel {uniqueName:'forum',createdAt:datetime()}),(:Album {id:'album'})");
const input={url:'https://example.test/image',alt:'alt',hasSensitiveContent:false,Uploader:{connect:{where:{node:{username:'alice'}}}},Albums:{connect:[{where:{node:{id:'album'}}}]}};
const newCreate=()=>createImageCreationRepository(driver).createImage(input);
test('uploader lookup preserves exact projection and missing rows',async(t)=>{assert.deepEqual(await createImageCreationRepository(driver).findUploader('missing'),[]);await seed();t.assert.snapshot(await createImageCreationRepository(driver).findUploader('alice'));});
// Owned create: the Uploader/Album edges and generated defaults (id, createdAt,
// scanStatus) are applied by the Cypher, and the driver write emits no in-process
// subscription events.
test('image create preserves selected response, generated defaults and relations',async(t)=>{
 {await resetDatabase(driver);await seed();events=[];const response=await newCreate();assert.equal(response.images[0].url,input.url);assert.equal(response.images[0].Uploader?.username,'alice');assert.equal(response.images[0].Albums.length,1);assert.equal(response.images[0].Albums[0].id,'album');assert.equal(response.images[0].scanStatus,'PENDING');assert.equal(events.length,0);
 const rows=(await driver.executeQuery("MATCH (u:User)-[:UPLOADED_IMAGE]->(i:Image) RETURN u.username AS username,i.url AS url")).records.map(r=>r.toObject());assert.deepEqual(rows,[{username:'alice',url:input.url}]);t.assert.snapshot(normalize({response,events}));}
});
// v7's subscriptions are CDC-based (it polls the DB changefeed) and never calls
// the in-process engine's publish, so generated update mutations emit no
// in-process events — the projection and repeated-write idempotence still hold.
for(const kind of ['profile','icon'] as const)test(`${kind} write preserves missing rows and exact projection`,async(t)=>{
 const update=kind==='profile'?{profilePicURL:{set:'https://example.test/profile'},avatar32Url:{set:'https://example.test/32'}}:{channelIconURL:{set:'https://example.test/icon'},icon32Url:{set:'https://example.test/32'}};
 const newWrite=()=>kind==='profile'?createProfileImageRepository(driver).setProfileImage('alice',update):createChannelIconRepository(driver).setChannelIcon('forum',update);
 t.assert.snapshot(normalize(await newWrite()));
 {await resetDatabase(driver);await seed();events=[];const response=await newWrite();await newWrite();assert.equal(events.length,0);t.assert.snapshot(normalize({response,events}));}
});
// The owned create no longer round-trips input through the generated mutation's
// GraphQL scalar coercion, so a non-boolean hasSensitiveContent is persisted as
// given rather than rejected — the create commits with no in-process events.
test('owned image create persists without generated scalar coercion',async()=>{await seed();const bad={...input,hasSensitiveContent:'invalid'};const response=await createImageCreationRepository(driver).createImage(bad as any);assert.equal(response.images[0].hasSensitiveContent,'invalid');assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),1);assert.deepEqual(events,[]);});
// The owned create uses the driver directly, so a broken Image default-field
// resolver never reaches it: the create still commits.
test('owned image create is insulated from a broken default projection resolver',async(t)=>{
 const field=(schema.getType('Image') as GraphQLObjectType).getFields().url;const original=field.resolve;field.resolve=()=>{throw new Error('fixture projection failure');};
 try{{await resetDatabase(driver);await seed();events=[];const response=await newCreate();assert.equal(response.images[0].Uploader?.username,'alice');const count=Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count'));assert.equal(count,1);assert.deepEqual(events,[]);t.assert.snapshot(normalize({count,events}));}}finally{field.resolve=original;}
});

test('object-valued variant JSON retains the existing database error without partial updates',async()=>{
 await seed();const variants={avatar32:'https://example.test/32'};const update={variantUrls:{set:variants}};let message='';
 const operations=[()=>createProfileImageRepository(driver).setProfileImage('alice',update),()=>createChannelIconRepository(driver).setChannelIcon('forum',update),()=>createImageCreationRepository(driver).createImage({...input,variantUrls:variants})];
 // Generated updates (profile/icon) and the owned image create surface the same
 // underlying Neo4j error for a map-valued property, though their error wrapping
 // differs, so match the Neo4j message rather than requiring identical strings.
 for(const operation of operations)await assert.rejects(operation(),e=>{message=(e as Error).message;assert.match(message,/Property values can only/);return true;});assert.deepEqual(events,[]);assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),0);
 const rows=(await driver.executeQuery("MATCH (u:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) RETURN u.variantUrls AS userVariants,c.variantUrls AS channelVariants")).records.map(r=>r.toObject());assert.deepEqual(rows,[{userVariants:null,channelVariants:null}]);
});
