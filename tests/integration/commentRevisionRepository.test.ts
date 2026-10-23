import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema,executeGeneratedOperation} from '../../services/persistence/generatedSchemaOperations.js';
import { createCommentRevisionRepository } from '../../services/persistence/commentRevisionRepository.js';
import middleware from '../../middleware/commentVersionHistoryMiddleware.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship'])engine.events.on(kind,event=>events.push(event));
async function registerSchema(overrides:Record<string,unknown>={}){const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,...overrides},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});registerGeneratedSchema(driver,await neo.getSchema());}
before(async()=>{driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));await registerSchema();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const seed=async(modAuthor=false)=>{await driver.executeQuery(`CREATE (u:User {username:'author',createdAt:datetime()}),(e:User {username:'editor',createdAt:datetime()}),(m:ModerationProfile {displayName:'mod'}),(c:Comment {id:'c',text:'old',isRootComment:true,createdAt:datetime()}),(d:Discussion {id:'d',title:'Discussion',createdAt:datetime()}),(dc:DiscussionChannel {discussionId:'d',channelUniqueName:'forum'}) CREATE (dc)-[:CONTAINS_COMMENT]->(c),(dc)-[:POSTED_IN_CHANNEL]->(d),(u)-[:MODERATION_PROFILE]->(m) WITH u,m,c FOREACH(ignore IN CASE WHEN $mod THEN [1] ELSE [] END|CREATE(m)-[:AUTHORED_COMMENT]->(c)) FOREACH(ignore IN CASE WHEN $mod THEN [] ELSE [1] END|CREATE(u)-[:AUTHORED_COMMENT]->(c))`,{mod:modAuthor});};
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','textLastEdited','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));};
const state=async()=>({rows:(await driver.executeQuery(`MATCH(c:Comment {id:'c'}) OPTIONAL MATCH(c)-[:HAS_VERSION]->(v:TextVersion) OPTIONAL MATCH(u:User)-[:AUTHORED_VERSION]->(v) RETURN c.text AS text,c.textLastEdited IS NOT NULL AS edited,v.body AS body,u.username AS editor,v.ageGateTouchedAt IS NOT NULL AS touched ORDER BY body`)).records.map(r=>r.toObject()),events:normalize(events)});
const run=async(repository:any)=>{const notifications:any[]=[];const ctx:any={driver,commentRevisionRepository:repository,user:{username:'editor'},notificationWriter:{createForUser:async(value:any)=>{notifications.push(value);return true;}},issueActivityRepository:{findRelatedIssueIds:async()=>[]}};await middleware.Mutation.updateComments(async()=>executeGeneratedOperation(driver,'mutation($where:CommentWhere!,$update:CommentUpdateInput!){updateComments(where:$where,update:$update){comments{id}}}',{where:{id:'c'},update:{text:'new'}}),null,{where:{id:'c'},update:{text:'new'}},ctx,{} as any);return {state:await state(),notifications};};
for(const mod of [false,true])test(`middleware snapshot and revision connection preserve graph/defaults/events for moderator author=${mod}`,async(t)=>{await seed(mod);const result=await run(createCommentRevisionRepository(driver));assert.equal(result.notifications.length,1);assert.equal(result.notifications[0].username,'author');assert.match(result.notifications[0].text,/\[Discussion\]/);assert.deepEqual(result.state.rows,[{text:'new',edited:true,body:'old',editor:'editor',touched:true}]);t.assert.snapshot(result);});
test('snapshot nested PastVersions limit and generated scalar validation remain identical',async(t)=>{await seed();await driver.executeQuery("MATCH(c:Comment {id:'c'}) UNWIND range(1,30) AS n CREATE(c)-[:HAS_VERSION]->(:TextVersion {id:toString(n),body:toString(n),createdAt:datetime()})");const actual=await createCommentRevisionRepository(driver).findSnapshot('c');assert.equal((actual[0] as any).PastVersions?.length,25);t.assert.snapshot(normalize(actual.map((comment:any)=>({...comment,PastVersions:comment.PastVersions?.length}))));await assert.rejects(createCommentRevisionRepository(driver).createPreviousText({body:12} as any),/String cannot represent a non string value/);});
test('default create projection failure preserves orphan version and skips connection while later notification continues',async(t)=>{
 await registerSchema({TextVersion:{editReason:()=>{throw Error('version projection failure');}}});
 try{await seed();const result=await run(createCommentRevisionRepository(driver));const count=async()=>(await driver.executeQuery('MATCH(v:TextVersion) RETURN count(v) AS n')).records[0].get('n').toNumber();assert.equal(await count(),1);assert.equal(result.state.rows[0].body,null);assert.equal(result.notifications.length,1);t.assert.snapshot(result);}finally{await registerSchema();}
});
test('default connect projection failure retains connection and continues notifications',async(t)=>{
 await registerSchema({Comment:{editReason:()=>{throw Error('comment projection failure');}}});
 try{await seed();const result=await run(createCommentRevisionRepository(driver));assert.equal(result.state.rows[0].body,'old');assert.equal(result.notifications.length,1);t.assert.snapshot(result);}finally{await registerSchema();}
});
