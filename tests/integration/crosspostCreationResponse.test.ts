import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import { staticResponsePaths, declaredResponsePaths } from "../helpers/staticResponsePaths.js";
import { crosspostIdentitySelection, createdDiscussionSelection } from "../../customResolvers/contracts/contentProjections.js";
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, defaultFieldResolver, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import type { Driver } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import getCreateResolver from '../../customResolvers/mutations/createDiscussionWithChannelConnections.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { installAgeGateReconcile } from '../../services/ageGate/reconcile.js';
import { getAgeGateStatements } from '../../services/ageGate/definitions.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';

let driver: Driver, schema: GraphQLSchema;
let fault: 'empty' | 'duplicate' | 'wrong-id' | 'projection' | undefined;
let failOn = 1, reads = 0, outerFailure = false;
let projectionCalls: {operation:string;paths:string[]}[]=[];
let dispatched: Array<{id:string;links:number}> = [];
before(async()=>{
  driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));
  const resolvers=getResolvers(driver).resolvers;
  resolvers.Mutation.createDiscussionWithChannelConnections=getCreateResolver({driver,
    triggerPipelines:async args=>{
      // The actual dispatch boundary queries through a separate database session:
      // only committed crossposts and their forum links can be visible here.
      const result=await driver.executeQuery(`MATCH(d:Discussion {id:$id})-[:CROSSPOSTED_DISCUSSION]->(:Discussion {id:'source'})
        MATCH(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d) RETURN count(dc) AS links`,{id:args.discussionId});
      dispatched.push({id:args.discussionId,links:result.records[0].get('links').toNumber()});
    },
  });
  const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();
  const createField=raw.getMutationType()!.getFields().createDiscussions;
  const create=createField.resolve!;
  createField.resolve=(source,args,context,info)=>{
    if(info.operation.name?.value==='CreateCrosspost')projectionCalls.push({operation:'CreateCrosspost',paths:staticResponsePaths(info)});
    return create(source,args,context,info);
  };
  const field=raw.getQueryType()!.getFields().discussions;
  const read=field.resolve!;
  field.resolve=async(source,args,context,info)=>{
    if(info.operation.name?.value==='CrosspostResult')projectionCalls.push({operation:'CrosspostResult',paths:staticResponsePaths(info)});
    const result=await read(source,args,context,info);
    if(info.operation.name?.value==='CrosspostResult' && ++reads===failOn){
      assert.ok(Array.isArray(result));
      assert.equal(result.length,1,'faults modify an otherwise valid real database result');
      if(fault==='empty')return [];
      if(fault==='duplicate')return [result[0],result[0]];
      if(fault==='wrong-id')return [{...result[0],id:'wrong-id'}];
    }
    return result;
  };
  const title=(raw.getType('Discussion') as GraphQLObjectType).getFields().title;
  const resolveTitle=title.resolve ?? defaultFieldResolver;
  title.resolve=(source,args,context,info)=>{
    if(fault==='projection' && info.operation.name?.value==='CrosspostResult' && reads===failOn)throw new Error('Fixture crosspost projection failure');
    if(outerFailure && !info.operation.name)throw new Error('Fixture outer completion failure');
    return resolveTitle(source,args,context,info);
  };
  registerGeneratedSchema(driver,raw);
  schema=applyMiddleware(raw,permissions,sourceIdentity);
},{timeout:240_000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
  fault=undefined;failOn=1;reads=0;outerFailure=false;dispatched=[];projectionCalls=[];
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE(a:User {username:'alice',createdAt:datetime()}),(b:User {username:'bob',createdAt:datetime()}),
    (c:Channel {uniqueName:'forum',imageUploadsEnabled:true}),(c2:Channel {uniqueName:'second',imageUploadsEnabled:true}),
    (d:Discussion {id:'source',title:'Source',createdAt:datetime()}),(i:Image {id:'reused',url:'reused.jpg',createdAt:datetime()})
    CREATE(a)-[:ADMIN_OF_CHANNEL]->(c) CREATE(a)-[:ADMIN_OF_CHANNEL]->(c2)
    CREATE(b)-[:POSTED_DISCUSSION]->(d) CREATE(b)-[:UPLOADED_IMAGE]->(i)`);
});
const item=(title='Crosspost')=>({discussionCreateInput:{title,
  Album:{create:{node:{imageOrder:[],Images:{create:[{node:{url:'new.jpg'}}],connect:[{where:{node:{id:{eq:'reused'}}}}]}}}}},
  channelConnections:['forum','second'],crosspostedDiscussionId:'source'});
const SOURCE=`mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title Author{username} DiscussionChannels{channelUniqueName}}}`;
const execute=(input:ReturnType<typeof item>[],username='alice',sensitive=false)=>graphql({schema,source:SOURCE,variableValues:{input},contextValue:{driver,req:{headers:{}},user:{username,email:null,email_verified:true,data:null},mayAccessSensitiveContent:sensitive}});
const ok=(r:Awaited<ReturnType<typeof execute>>)=>{assert.equal(r.errors,undefined,JSON.stringify(r.errors));return (r.data as any).createDiscussionWithChannelConnections as Array<{id:string;title:string;Author:{username:string}}>;};
async function titles(){return (await driver.executeQuery('MATCH(d:Discussion) WHERE d.id<>"source" RETURN d.title AS title ORDER BY title')).records.map(r=>r.get('title'));}
async function assertRolledBack(){
  assert.deepEqual(await titles(),[]);
  assert.equal((await driver.executeQuery('MATCH(n) WHERE n:Album OR n:DiscussionChannel OR (n:Image AND n.id<>"reused") RETURN n')).records.length,0);
  assert.equal((await driver.executeQuery('MATCH(:User {username:"bob"})-[:POSTED_DISCUSSION]->(:Discussion {id:"source"}) RETURN 1')).records.length,1);
  assert.equal((await driver.executeQuery('MATCH(:User {username:"bob"})-[:UPLOADED_IMAGE]->(:Image {id:"reused"}) RETURN 1')).records.length,1);
  assert.deepEqual(dispatched,[]);
}
test('crosspost success retains ownership and dispatches only after all links commit',async()=>{
  const [created]=ok(await execute([item()]));
  assert.equal(created.Author.username,'alice');
  assert.deepEqual(dispatched,[{id:created.id,links:2}]);
  const owners=await driver.executeQuery(`MATCH(:Discussion {id:$id})-[:HAS_ALBUM]->(a:Album)<-[:HAS_ALBUM]-(:User {username:'alice'})
    MATCH(a)-[:HAS_IMAGE]->(i:Image)<-[:UPLOADED_IMAGE]-(u:User) RETURN i.url AS url,u.username AS owner ORDER BY url`,{id:created.id});
  assert.deepEqual(owners.records.map(r=>r.toObject()),[{url:'new.jpg',owner:'alice'},{url:'reused.jpg',owner:'bob'}]);
});
for(const mode of ['empty','duplicate','wrong-id','projection'] as const){
  test(`${mode} crosspost response rolls back before plugin dispatch`,async()=>{
    fault=mode;
    const result=await execute([item()]);
    await assertRolledBack();
    assert.match(JSON.stringify(result.errors),mode==='projection'?/Fixture crosspost projection failure/:/Created crosspost is unavailable/);
    assert.equal(reads,1);
  });
  test(`${mode} in a later batch item preserves the first commit and leaves subsequent items unattempted`,async()=>{
    fault=mode;failOn=2;
    const result=await execute([item('First'),item('Failed'),item('Unattempted')]);
    assert.deepEqual(await titles(),['First']);
    assert.ok(result.errors);
    assert.equal(reads,2);
    assert.equal(dispatched.length,1);
    assert.equal(dispatched[0].links,2);
    assert.equal((await driver.executeQuery('MATCH(a:Album) RETURN a')).records.length,1);
    assert.equal((await driver.executeQuery('MATCH(i:Image) RETURN i')).records.length,2);
  });
}
test('missing, deleted and sensitive sources remain unavailable to restricted callers',async()=>{
  assert.ok((await execute([{...item(),crosspostedDiscussionId:'missing'}])).errors);
  await driver.executeQuery('MATCH(d:Discussion {id:"source"}) SET d.deleted=true');
  assert.ok((await execute([item()])).errors);
  await driver.executeQuery('MATCH(d:Discussion {id:"source"}) SET d.deleted=false,d.hasSensitiveContent=true');
  assert.ok((await execute([item()])).errors);
  await assertRolledBack();
});
test('eligible viewers retain access to sensitive source and response with reconciled channel flags',async()=>{
  await driver.executeQuery('MATCH(d:Discussion {id:"source"}) SET d.hasSensitiveContent=true');
  const input={...item(),discussionCreateInput:{...item().discussionCreateInput,hasSensitiveContent:true}};
  const [created]=ok(await execute([input],'alice',true));
  assert.deepEqual(dispatched,[{id:created.id,links:2}]);
  const flags=await driver.executeQuery('MATCH(dc:DiscussionChannel {discussionId:$id}) RETURN dc.ageGateRestricted AS restricted',{id:created.id});
  assert.deepEqual(flags.records.map(r=>r.get('restricted')),[true,true]);
});
test('anonymous and unauthorized callers retain the permission gate',async()=>{
  assert.ok((await execute([item()],'')).errors);
  assert.ok((await execute([item()],'bob')).errors);
  await assertRolledBack();
});
test('unavailable reused images cannot be copied or attributed',async()=>{
  await driver.executeQuery('MATCH(i:Image {id:"reused"}) SET i.hasSensitiveContent=true');
  assert.ok((await execute([item()])).errors);
  await driver.executeQuery('MATCH(i:Image {id:"reused"}) SET i.hasSensitiveContent=false,i.archived=true');
  assert.ok((await execute([item()])).errors);
  await assertRolledBack();
});
test('outer GraphQL completion still happens after commit',async()=>{
  outerFailure=true;
  assert.match(JSON.stringify((await execute([item()])).errors),/Fixture outer completion failure/);
  assert.deepEqual(await titles(),['Crosspost']);
  assert.equal(dispatched.length,1);
});

test('actual ID-only CreateCrosspost and shared CrosspostResult documents match precise projections',async()=>{
  const result=await execute([item()]);
  assert.deepEqual(projectionCalls,[
    {operation:'CreateCrosspost',paths:declaredResponsePaths({discussions:crosspostIdentitySelection})},
    {operation:'CrosspostResult',paths:declaredResponsePaths(createdDiscussionSelection)},
  ]);
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
});

test('crosspost response aliases preserve the completed fixed projection and nested author/channel keys',async()=>{
 const source=`mutation($input:[DiscussionCreateInputWithChannels!]!){result:createDiscussionWithChannelConnections(input:$input){key:id id:title ...Fields Author{name:username} links:DiscussionChannels{forum:channelUniqueName Discussion{key:id} Channel{name:uniqueName}}}} fragment Fields on Discussion {label:title text:body}`;
 const result=await graphql({schema,source,variableValues:{input:[item()]},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const response=JSON.parse(JSON.stringify(result.data)).result[0];
 assert.equal(response.id,'Crosspost'); assert.equal(response.label,'Crosspost'); assert.equal(response.text,null); assert.equal(response.Author.name,'alice');
 assert.deepEqual(response.links.map((link:{forum:string})=>link.forum).sort(),['forum','second']);
 assert.ok(response.links.every((link:{Discussion:{key:string};Channel:{name:string};forum:string})=>link.Discussion.key===response.key&&link.Channel.name===link.forum));
 assert.deepEqual(dispatched,[{id:response.key,links:2}]);
});

test('ordinary discussion creation preserves colliding aliases and selected fixed children',async()=>{
 const {crosspostedDiscussionId:_crosspost,...ordinary}=item('Ordinary');
 const source=`mutation($input:[DiscussionCreateInputWithChannels!]!,$skip:Boolean!){result:createDiscussionWithChannelConnections(input:$input){title:id id:title Author{name:username} links:DiscussionChannels{forum:channelUniqueName} body @skip(if:$skip)}}`;
 const result=await graphql({schema,source,variableValues:{input:[ordinary],skip:true},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const response=JSON.parse(JSON.stringify(result.data)).result[0];
 assert.equal(response.id,'Ordinary');assert.equal(response.Author.name,'alice');assert.equal(response.body,undefined);
 assert.deepEqual(response.links.map((link:{forum:string})=>link.forum).sort(),['forum','second']);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion {id:$id}) RETURN d.title AS title',{id:response.title})).records[0].get('title'),'Ordinary');
});
