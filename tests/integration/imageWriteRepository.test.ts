import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createImageCreationRepository,createProfileImageRepository,createChannelIconRepository,CREATED_IMAGE_SELECTION,PROFILE_IMAGE_SELECTION,CHANNEL_ICON_SELECTION} from '../../services/persistence/imageWriteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
import {denyImageExternalIo} from '../denyImageExternalIo.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];let schema:GraphQLSchema;let guard:ReturnType<typeof denyImageExternalIo>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});schema=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,schema);registerGeneratedSchema(driver,schema);guard=denyImageExternalIo();},{timeout:240000});
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
const oldCreate=()=>ogm.model('Image').create({input:[input],selectionSet:`{ images ${CREATED_IMAGE_SELECTION} }`});
const newCreate=()=>createImageCreationRepository(driver).createImage(input);
test('uploader lookup preserves exact projection and missing rows',async()=>{assert.deepEqual(await createImageCreationRepository(driver).findUploader('missing'),[]);await seed();assert.deepEqual(await createImageCreationRepository(driver).findUploader('alice'),await ogm.model('User').find({where:{username:'alice'},selectionSet:'{username}'}));});
test('image create preserves selected response, generated defaults, relations and native events',async()=>{
 let expected:unknown;
 for(const create of [oldCreate,newCreate]){await resetDatabase(driver);await seed();events=[];const response=await create();assert.equal(response.images[0].url,input.url);assert.equal(response.images[0].Uploader?.username,'alice');assert.equal(response.images[0].Albums.length,1);assert.equal(response.images[0].Albums[0].id,'album');assert.ok(events.length>0);
 const rows=(await driver.executeQuery("MATCH (u:User)-[:UPLOADED_IMAGE]->(i:Image) RETURN u.username AS username,i.url AS url")).records.map(r=>r.toObject());assert.deepEqual(rows,[{username:'alice',url:input.url}]);const actual=normalize({response,events});if(create===oldCreate)expected=actual;else assert.deepEqual(actual,expected);}
});
for(const kind of ['profile','icon'] as const)test(`${kind} write preserves missing rows, exact projection and repeated update events`,async()=>{
 const update=kind==='profile'?{profilePicURL:'https://example.test/profile',avatar32Url:'https://example.test/32'}:{channelIconURL:'https://example.test/icon',icon32Url:'https://example.test/32'};
 const oldWrite=()=>kind==='profile'?ogm.model('User').update({where:{username:'alice'},update,selectionSet:`{ users ${PROFILE_IMAGE_SELECTION} }`}):ogm.model('Channel').update({where:{uniqueName:'forum'},update,selectionSet:`{ channels ${CHANNEL_ICON_SELECTION} }`});
 const newWrite=()=>kind==='profile'?createProfileImageRepository(driver).setProfileImage('alice',update):createChannelIconRepository(driver).setChannelIcon('forum',update);
 assert.deepEqual(await newWrite(),await oldWrite());let expected:unknown;
 for(const write of [oldWrite,newWrite]){await resetDatabase(driver);await seed();events=[];const response=await write();await write();assert.equal(events.length,2);const actual=normalize({response,events});if(write===oldWrite)expected=actual;else assert.deepEqual(actual,expected);}
});
test('generated image input validation rejects before writes with the legacy first error',async()=>{await seed();const bad={...input,hasSensitiveContent:'invalid'};let message='';await assert.rejects(ogm.model('Image').create({input:[bad] as any,selectionSet:`{ images ${CREATED_IMAGE_SELECTION} }`}),e=>{message=(e as Error).message;return true;});await assert.rejects(createImageCreationRepository(driver).createImage(bad as any),{message});assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),0);assert.deepEqual(events,[]);});
test('image projection failure leaves the same committed graph and events',async()=>{
 const field=(schema.getType('Image') as GraphQLObjectType).getFields().url;const original=field.resolve;field.resolve=()=>{throw new Error('fixture projection failure');};
 try{let expected:unknown;for(const create of [oldCreate,newCreate]){await resetDatabase(driver);await seed();events=[];await assert.rejects(create(),{message:'fixture projection failure'});const count=Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count'));assert.equal(count,1);const actual=normalize({count,events});if(create===oldCreate)expected=actual;else assert.deepEqual(actual,expected);}}finally{field.resolve=original;}
});

test('object-valued variant JSON retains the existing database error without partial updates',async()=>{
 await seed();const update={variantUrls:{avatar32:'https://example.test/32'}};let message='';
 const operations=[()=>ogm.model('User').update({where:{username:'alice'},update,selectionSet:`{ users ${PROFILE_IMAGE_SELECTION} }`}),()=>createProfileImageRepository(driver).setProfileImage('alice',update),()=>ogm.model('Channel').update({where:{uniqueName:'forum'},update,selectionSet:`{ channels ${CHANNEL_ICON_SELECTION} }`}),()=>createChannelIconRepository(driver).setChannelIcon('forum',update),()=>ogm.model('Image').create({input:[{...input,...update}],selectionSet:`{ images ${CREATED_IMAGE_SELECTION} }`}),()=>createImageCreationRepository(driver).createImage({...input,...update})];
 for(const operation of operations)await assert.rejects(operation(),e=>{if(!message)message=(e as Error).message;assert.equal((e as Error).message,message);return true;});assert.match(message,/Property values can only/);assert.deepEqual(events,[]);assert.equal(Number((await driver.executeQuery('MATCH (i:Image) RETURN count(i) AS count')).records[0].get('count')),0);
 const rows=(await driver.executeQuery("MATCH (u:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) RETURN u.variantUrls AS userVariants,c.variantUrls AS channelVariants")).records.map(r=>r.toObject());assert.deepEqual(rows,[{userVariants:null,channelVariants:null}]);
});
