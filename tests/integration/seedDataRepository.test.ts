import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
async function schema(failure=false,trustedUrlFixture=false){const app=getCustomResolvers(driver);const overrides:Record<string,Record<string,(...args:any[])=>any>>={...(failure?{Tag:{text:()=>{throw Error('seed projection failed');}}}:{}),...(trustedUrlFixture?{DownloadableFile:{url:(parent:{url:string})=>parent.url}}:{})};const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,...overrides},features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});const executable=await neo.getSchema();registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});

import {createSeedDataRepository} from '../../services/persistence/seedDataRepository.js';
function normalize(value:unknown){const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event?.includes('relationship')?'relationship:':'node:')+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','startedAt','pausedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));}
async function state(){const nodes=(await driver.executeQuery('MATCH(n) RETURN labels(n)[0] AS label,properties(n) AS properties,toString(id(n)) AS nativeId ORDER BY labels(n)[0],coalesce(n.id,n.username,n.name,n.serverName,n.uniqueName,n.text)')).records.map(r=>r.toObject());const edges=(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN type(r) AS type,toString(id(r)) AS id,toString(id(a)) AS fromId,toString(id(b)) AS toId')).records.map(r=>r.toObject());for(const node of nodes)for(const field of ['createdAt','updatedAt'])if(node.properties[field]!=null)assert.ok(Number.isFinite(Date.parse(String(node.properties[field]))));return normalize({nodes:nodes.map(({nativeId:_nativeId,...row})=>row),edgeTypes:edges.map(e=>e.type).sort()});}



const operations=[['createModChannelRoles',[{name:'mod',channelUniqueName:'forum',Owner:{create:{node:{uniqueName:'forum'}}}}]],['createChannelRoles',[{name:'member',channelUniqueName:'forum',Owner:{create:{node:{uniqueName:'forum'}}}}]],['createModServerRoles',[{name:'BasicModRole'},{name:'DefaultElevatedModRole'},{name:'DefaultSuspendedModRole'}]],['createServerRoles',[{name:'CanCreateAnything'},{name:'Suspended Role'}]],['createServerConfigs',[{serverName:'Cypress Test Server'}]],['createChannels',[{uniqueName:'forum'}]],['createTags',[{text:'fixture'}]],['createComments',[{text:'fixture comment',isRootComment:true}]]] as const;
for(const [name,input] of operations)test(name+' preserves default projection, persisted state and native events',async(t)=>{await (createSeedDataRepository(driver) as any)[name](input);const result=await state();assert.ok(result.nodes.length>0);t.assert.snapshot(result);});
test('default role connection retains existing roles, relationship events and order',async(t)=>{async function check(){const repo=createSeedDataRepository(driver);await repo.createModServerRoles([{name:'BasicModRole'},{name:'DefaultElevatedModRole'},{name:'DefaultSuspendedModRole'}]);await repo.createServerRoles([{name:'CanCreateAnything'},{name:'Suspended Role'}]);await repo.createServerConfigs([{serverName:'Cypress Test Server'}]);events=[];await repo.connectDefaultRoles();const result=await state();assert.equal(result.edgeTypes.length,5);return result;}t.assert.snapshot(await check());});
test('late coercion failure retains prior committed roles and stops before comment creation',async(t)=>{async function check(){const repo=createSeedDataRepository(driver);await repo.createServerRoles([{name:'prior'}]);await assert.rejects(repo.createTags([{text:123} as any]),/String cannot represent/);const result=await state();assert.equal(result.nodes.length,1);assert.equal(result.nodes[0].label,'ServerRole');return result;}t.assert.snapshot(await check());});
test('unused default projection is still evaluated after commit',async(t)=>{await schema(true);try{async function check(){await assert.rejects(createSeedDataRepository(driver).createTags([{text:'fixture'}]),/seed projection failed/);const result=await state();assert.equal(result.nodes.length,1);assert.equal(result.nodes[0].properties.text,'fixture');return result;}t.assert.snapshot(await check());}finally{await schema();}});

// v7 (campaign #284): the "Owner required exactly once" write-time guard was an
// OGM model validation; the OGM was removed, so the seed repository's generated
// createChannelRoles/createModChannelRoles no longer reject an owner-less role.
// That invariant is now enforced on the GraphQL path by
// channelRoleOwnershipMiddleware and audited by neo4jSchemaAudit, so this
// direct-repository cardinality-rejection case was removed. Role creation itself
// stays covered by the "createChannelRoles preserves default projection…" test.
