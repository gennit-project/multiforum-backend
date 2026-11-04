import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import { Neo4jError, type Driver } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import createResolver, { triggerCreatedDiscussionPipelines } from '../../customResolvers/mutations/createDiscussionWithChannelConnections.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { installAgeGateReconcile } from '../../services/ageGate/reconcile.js';
import { getAgeGateStatements } from '../../services/ageGate/definitions.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';

const previousConfig = process.env.SERVER_CONFIG_NAME;
let driver: Driver, schema: GraphQLSchema;
let lookupFailure = false, failOn = 1, reads = 0, retry = false, attempts = 0, failDownload = false;
let events: string[] = [], tasks: Promise<unknown[]>[] = [];
let lookupContexts: Array<{ transaction: boolean; jwt: unknown }> = [];
let observedCommit = 0;
before(async () => {
  process.env.SERVER_CONFIG_NAME = 'attachment-fixture';
  driver = installAgeGateReconcile(await startNeo4j(), getAgeGateStatements(typeDefs));
  const sessionFactory = driver.session.bind(driver);
  driver.session = (...args) => {
    const session = sessionFactory(...args);
    const write = session.executeWrite.bind(session);
    session.executeWrite = work => write(async tx => {
      const result = await work(tx);
      // Exercise the real driver's retry after a completed item callback, while
      // the first attempt is still uncommitted. No provider may have run yet.
      if (retry && reads > 0) {
        retry = false; attempts++;
        assert.deepEqual(events, []);
        throw new Neo4jError('Fixture transaction retry', 'Neo.TransientError.Transaction.DeadlockDetected', '50N42', 'Fixture retry');
      }
      return result;
    });
    return session;
  };
  const resolvers = getResolvers(driver).resolvers;
  resolvers.Mutation.createDiscussionWithChannelConnections = createResolver({driver,
    triggerPipelines: async args => {
      const committed = await driver.executeQuery(`MATCH(d:Discussion {id:$id})<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
        RETURN count(dc) AS links`, {id:args.discussionId});
      assert.equal(committed.records[0].get('links').toNumber(), 2);
      observedCommit++;
      return triggerCreatedDiscussionPipelines({...args,
        triggerDownload: async ({downloadableFileId}) => {
          const file = await driver.executeQuery('MATCH(f:DownloadableFile {id:$id}) RETURN f.fileName AS name', {id:downloadableFileId});
          events.push(`file:${file.records[0].get('name')}`);
          if (failDownload) throw new Error('Fixture provider failure');
          return [];
        },
        triggerChannel: async ({channelUniqueName}) => {
          events.push(`channel:${channelUniqueName}`);
          const task = Promise.resolve([]); tasks.push(task); return task;
        },
      });
    },
  });
  const raw = await new Neo4jGraphQL({driver,typeDefs,resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();
  const field = raw.getQueryType()!.getFields().discussions, original = field.resolve!;
  field.resolve = async (source,args,context,info) => {
    const lookupContext = {transaction:!!context.executionContext,jwt:context.jwt};
    const result = await original(source,args,context,info);
    if (info.operation.name?.value === 'CreatedDiscussionFiles') {
      reads++;
      lookupContexts.push(lookupContext);
      if (lookupFailure && reads === failOn) throw new Error('Fixture attachment lookup failure');
    }
    return result;
  };
  registerGeneratedSchema(driver,raw); schema = applyMiddleware(raw,permissions);
},{timeout:240_000});
after(async () => {
  await stopNeo4j();
  if (previousConfig === undefined) delete process.env.SERVER_CONFIG_NAME; else process.env.SERVER_CONFIG_NAME = previousConfig;
});
beforeEach(async () => {
  await Promise.allSettled(tasks);
  lookupFailure=false;failOn=1;reads=0;retry=false;attempts=0;failDownload=false;
  events=[];tasks=[];lookupContexts=[];observedCommit=0;
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE(:ServerConfig {serverName:'attachment-fixture',enableDownloads:true,allowedFileTypes:['zip']}),
    (u:User {username:'alice',createdAt:datetime()}),(c:Channel {uniqueName:'forum',downloadsEnabled:true,allowedFileTypes:['zip']}),
    (c2:Channel {uniqueName:'second',downloadsEnabled:true,allowedFileTypes:['zip']}),
    (:Discussion {id:'source',title:'Source',createdAt:datetime()})
    CREATE(u)-[:ADMIN_OF_CHANNEL]->(c) CREATE(u)-[:ADMIN_OF_CHANNEL]->(c2)`);
});
const file = (fileName:string) => ({fileName,url:fileName,kind:'ZIP'});
const item = (crosspost=true,title='Created',count=2) => ({
  ...(crosspost ? {crosspostedDiscussionId:'source'} : {}),channelConnections:['forum','second'],
  discussionCreateInput:{title,hasDownload:true,DownloadableFiles:{create:Array.from({length:count},(_,i)=>({node:file(`new-${i}.zip`)}))}},
});
async function execute(input:unknown[], sensitive=false, username='alice') {
  const result=await graphql({schema,source:`mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title}}`,
    variableValues:{input},contextValue:{driver,req:{headers:{}},user:{username,email:null,email_verified:true,data:null},mayAccessSensitiveContent:sensitive}});
  await Promise.allSettled(tasks);return result;
}
const ok=(result:Awaited<ReturnType<typeof execute>>)=>assert.equal(result.errors,undefined,JSON.stringify(result.errors));
async function titles(){return (await driver.executeQuery('MATCH(d:Discussion) WHERE d.id<>"source" RETURN d.title AS title ORDER BY title')).records.map(r=>r.get('title'));}
function allFiles(names:string[]) {
  assert.deepEqual(new Set(events.slice(0,names.length)),new Set(names.map(n=>`file:${n}`)));
  assert.equal(events.length,names.length+2);
  assert.deepEqual(events.slice(names.length),['channel:forum','channel:second']);
}
for (const crosspost of [true,false]) {
  for (const mode of ['create','connect','mixed'] as const) test(`${crosspost?'crosspost':'ordinary'} processes every ${mode} attachment before channels`,async()=>{
    await driver.executeQuery(`UNWIND ['existing','another'] AS id CREATE(:DownloadableFile {id:id,fileName:id+'.zip',url:id+'.zip',kind:'ZIP',createdAt:datetime()})`);
    const input=item(crosspost,'Created',mode==='connect'?0:2);
    const attachments={...input.discussionCreateInput.DownloadableFiles,...(mode==='create'?{}:{connect:['existing','another'].map(id=>({where:{node:{id:{eq:id}}}}))})};
    ok(await execute([{...input,discussionCreateInput:{...input.discussionCreateInput,DownloadableFiles:attachments}}]));
    allFiles([...(mode==='connect'?[]:['new-0.zip','new-1.zip']),...(mode==='create'?[]:['existing.zip','another.zip'])]);
    assert.equal(observedCommit,1);
    assert.deepEqual(lookupContexts,[{transaction:true,jwt:undefined}]);
  });
  test(`${crosspost?'crosspost':'ordinary'} accepts empty attachments and respects hasDownload=false`,async()=>{
    ok(await execute([item(crosspost,'Empty',0)]));allFiles([]);
    events=[];reads=0;
    const input=item(crosspost);ok(await execute([{...input,discussionCreateInput:{...input.discussionCreateInput,hasDownload:false}}]));
    allFiles([]);assert.equal(reads,0);
  });
  test(`${crosspost?'crosspost':'ordinary'} provider failures do not suppress remaining files or channels`,async()=>{
    failDownload=true;ok(await execute([item(crosspost)]));allFiles(['new-0.zip','new-1.zip']);assert.deepEqual(await titles(),['Created']);
  });
}
test('crosspost attachment errors roll back owned nodes and do not dispatch',async()=>{
  lookupFailure=true;
  assert.match(JSON.stringify((await execute([item()])).errors),/Fixture attachment lookup failure/);
  assert.deepEqual(await titles(),[]);assert.deepEqual(events,[]);assert.equal(observedCommit,0);
  const nodes=await driver.executeQuery('MATCH(n) WHERE n:DownloadableFile OR n:DiscussionChannel RETURN n');assert.equal(nodes.records.length,0);
});
test('crosspost batch preserves earlier item and does not attempt later items after lookup failure',async()=>{
  lookupFailure=true;failOn=2;
  assert.ok((await execute([item(true,'First'),item(true,'Failed'),item(true,'Unattempted')])).errors);
  assert.deepEqual(await titles(),['First']);assert.equal(reads,2);assert.equal(observedCommit,1);allFiles(['new-0.zip','new-1.zip']);
});
for (const crosspost of [true,false]) test(`${crosspost?'crosspost':'ordinary'} retry rolls back the first attempt and dispatches each file once after commit`,async()=>{
  retry=true;ok(await execute([item(crosspost)]));assert.equal(attempts,1);assert.equal(reads,2);
  allFiles(['new-0.zip','new-1.zip']);assert.equal(observedCommit,1);assert.deepEqual(await titles(),['Created']);
  assert.equal((await driver.executeQuery('MATCH(f:DownloadableFile) RETURN f')).records.length,2);
});
test('eligible caller does not confer a JWT on the attachment read for a sensitive crosspost',async()=>{
  const input=item();ok(await execute([{...input,discussionCreateInput:{...input.discussionCreateInput,hasSensitiveContent:true}}],true));
  allFiles([]);assert.deepEqual(lookupContexts,[{transaction:true,jwt:undefined}]);
  const flags=await driver.executeQuery('MATCH(f:DownloadableFile) RETURN f.ageGateRestricted AS restricted');
  assert.deepEqual(flags.records.map(r=>r.get('restricted')),[true,true]);
});
for (const crosspost of [true,false]) test(`${crosspost?'crosspost':'ordinary'} newly sensitive nested attachments are reconciled before the no-JWT lookup`,async()=>{
  const input=item(crosspost);
  const hidden={node:{...file('hidden.zip'),Discussion:{create:{node:{title:'Sensitive parent',hasSensitiveContent:true}}}}};
  ok(await execute([{...input,discussionCreateInput:{...input.discussionCreateInput,DownloadableFiles:{create:[...input.discussionCreateInput.DownloadableFiles.create,hidden]}}}],true));
  allFiles(['new-0.zip','new-1.zip']);
  const flag=await driver.executeQuery('MATCH(f:DownloadableFile {fileName:"hidden.zip"}) RETURN f.ageGateRestricted AS restricted');assert.equal(flag.records[0].get('restricted'),true);
});
test('unauthorized callers do not create or dispatch attachments',async()=>{
  assert.ok((await execute([item()],false,'')).errors);assert.deepEqual(await titles(),[]);assert.equal(reads,0);assert.deepEqual(events,[]);
});

test('ordinary attachment lookup failure rolls back owned data and retains reused files and images',async()=>{
  await driver.executeQuery(`CREATE(u:User {username:'bob',createdAt:datetime()}),
    (i:Image {id:'reused-image',url:'reused.jpg',createdAt:datetime()}),
    (f:DownloadableFile {id:'reused-file',fileName:'reused.zip',url:'reused.zip',kind:'ZIP',createdAt:datetime()})
    CREATE(u)-[:UPLOADED_IMAGE]->(i)`);
  await driver.executeQuery('MATCH(c:Channel) SET c.imageUploadsEnabled=true');
  const input=item(false);
  lookupFailure=true;
  const result=await execute([{...input,discussionCreateInput:{...input.discussionCreateInput,
    DownloadableFiles:{...input.discussionCreateInput.DownloadableFiles,connect:[{where:{node:{id:{eq:'reused-file'}}}}]},
    Album:{create:{node:{imageOrder:[],Images:{create:[{node:{url:'new.jpg'}}],connect:[{where:{node:{id:{eq:'reused-image'}}}}]}}}},
  }}]);
  assert.match(JSON.stringify(result.errors),/Fixture attachment lookup failure/);
  assert.deepEqual(await titles(),[]);assert.deepEqual(events,[]);assert.equal(observedCommit,0);
  assert.equal((await driver.executeQuery('MATCH(n) WHERE n:Album OR n:DiscussionChannel OR (n:Image AND n.id<>"reused-image") OR (n:DownloadableFile AND n.id<>"reused-file") RETURN n')).records.length,0);
  assert.equal((await driver.executeQuery('MATCH(:User {username:"bob"})-[:UPLOADED_IMAGE]->(:Image {id:"reused-image"}) RETURN 1')).records.length,1);
  assert.equal((await driver.executeQuery('MATCH(f:DownloadableFile {id:"reused-file"}) WHERE NOT EXISTS { MATCH (:Discussion)-[:HAS_DOWNLOADABLE_FILE]->(f) } RETURN f')).records.length,1);
});
for (const firstCrosspost of [true,false]) test(`mixed batch retains ${firstCrosspost?'crosspost':'ordinary'} commit when ordinary attachment lookup fails`,async()=>{
  lookupFailure=true;failOn=2;
  const result=await execute([item(firstCrosspost,'First'),item(false,'Failed'),item(!firstCrosspost,'Unattempted')]);
  assert.match(JSON.stringify(result.errors),/Fixture attachment lookup failure/);
  assert.deepEqual(await titles(),['First']);assert.equal(reads,2);assert.equal(observedCommit,1);
  allFiles(['new-0.zip','new-1.zip']);
  assert.equal((await driver.executeQuery('MATCH(f:DownloadableFile) RETURN f')).records.length,2);
});
