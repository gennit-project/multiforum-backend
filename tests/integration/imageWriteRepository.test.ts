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
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);guard=denyImageExternalIo();},{timeout:240000});
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
test('image create preserves selected response, generated defaults, relations and native events',async(t)=>{
 {await resetDatabase(driver);await seed();events=[];const response=await newCreate();assert.equal(response.images[0].url,input.url);assert.equal(response.images[0].Uploader?.username,'alice');assert.equal(response.images[0].Albums.length,1);assert.equal(response.images[0].Albums[0].id,'album');assert.ok(events.length>0);
 const rows=(await driver.executeQuery("MATCH (u:User)-[:UPLOADED_IMAGE]->(i:Image) RETURN u.username AS username,i.url AS url")).records.map(r=>r.toObject());assert.deepEqual(rows,[{username:'alice',url:input.url}]);t.assert.snapshot(normalize({response,events}));}
});
for(const kind of ['profile','icon'] as const)test(`${kind} write preserves missing rows, exact projection and repeated update events`,async(t)=>{
 const update=kind==='profile'?{profilePicURL:'https://example.test/profile',avatar32Url:'https://example.test/32'}:{channelIconURL:'https://example.test/icon',icon32Url:'https://example.test/32'};
 const newWrite=()=>kind==='profile'?createProfileImageRepository(driver).setProfileImage('alice',update):createChannelIconRepository(driver).setChannelIcon('forum',update);
 t.assert.snapshot(normalize(await newWrite()));
 {await resetDatabase(driver);await seed();events=[];const response=await newWrite();await newWrite();assert.equal(events.length,2);t.assert.snapshot(normalize({response,events}));}
});
test('generated image input validation rejects before writes with the legacy first error',async()=>{await seed();const bad={...input,hasSensitiveContent:'invalid'};await assert.rejects(createImageCreationRepository(driver).createImage(bad as any),/Boolean cannot represent a non boolean value/);assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),0);assert.deepEqual(events,[]);});
test('image projection failure leaves the same committed graph and events',async(t)=>{
 const field=(schema.getType('Image') as GraphQLObjectType).getFields().url;const original=field.resolve;field.resolve=()=>{throw new Error('fixture projection failure');};
 try{{await resetDatabase(driver);await seed();events=[];await assert.rejects(newCreate(),{message:'fixture projection failure'});const count=Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count'));assert.equal(count,1);t.assert.snapshot(normalize({count,events}));}}finally{field.resolve=original;}
});

test('object-valued variant JSON retains the existing database error without partial updates',async()=>{
 await seed();const update={variantUrls:{avatar32:'https://example.test/32'}};let message='';
 const operations=[()=>createProfileImageRepository(driver).setProfileImage('alice',update),()=>createChannelIconRepository(driver).setChannelIcon('forum',update),()=>createImageCreationRepository(driver).createImage({...input,...update})];
 for(const operation of operations)await assert.rejects(operation(),e=>{if(!message)message=(e as Error).message;assert.equal((e as Error).message,message);return true;});assert.match(message,/Property values can only/);assert.deepEqual(events,[]);assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),0);
 const rows=(await driver.executeQuery("MATCH (u:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) RETURN u.variantUrls AS userVariants,c.variantUrls AS channelVariants")).records.map(r=>r.toObject());assert.deepEqual(rows,[{userVariants:null,channelVariants:null}]);
});
