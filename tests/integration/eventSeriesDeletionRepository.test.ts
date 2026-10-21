import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {isInt, type Driver} from 'neo4j-driver';
import {getNamedType, type GraphQLSchema, type GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import getResolver from '../../customResolvers/mutations/deleteEventInSeries.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventSeriesDeletionRepository, SERIES_DELETION_SNAPSHOT_SELECTION, type EventSeriesDeletionRepository} from '../../services/persistence/eventSeriesDeletionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';
let driver: Driver; let app: ReturnType<typeof getCustomResolvers>; let schema: GraphQLSchema;
let events: any[] = []; const engine = createSubscriptionEngine();
for (const kind of ['delete','delete_relationship','create','update']) engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});schema=await neo.getSchema();initializeOgmFromExistingSchema(app.ogm,neo,schema);registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
function baseline(): EventSeriesDeletionRepository {const e=app.ogm.model('Event'),s=app.ogm.model('EventSeries');return {
 findSnapshot:id=>e.find({where:{id},selectionSet:SERIES_DELETION_SNAPSHOT_SELECTION}),
 deleteOccurrence:async id=>{await e.delete({where:{id}});},deleteTemplate:async id=>{await s.delete({where:{id}});},
};}
async function seed(linked=true,count=3){await driver.executeQuery("CREATE(s:EventSeries{id:'s',title:'Series',createdAt:datetime('2020-01-01T00:00:00Z')}) WITH s UNWIND range(0,$last) AS i CREATE(e:Event{id:'e'+toString(i),title:'Occurrence',occurrenceIndex:i,canceled:false,startTime:datetime('2026-06-01T10:00:00Z'),endTime:datetime('2026-06-01T12:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')}) FOREACH(_ IN CASE WHEN $linked THEN [1] ELSE [] END | CREATE(s)-[:HAS_OCCURRENCE]->(e))",{linked,last:count-1});}
const plain=(v:unknown)=>JSON.parse(JSON.stringify(v,(_key,x)=>{if(!isInt(x))return x;assert.ok(x.inSafeRange());return x.toNumber();}));
async function state(){return {
 nodes:(await driver.executeQuery('MATCH(n) RETURN labels(n) AS labels,properties(n) AS properties ORDER BY n.id')).records.map(r=>r.toObject()),
 rels:(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN a.id AS source,type(r) AS type,b.id AS target ORDER BY source,target')).records.map(r=>r.toObject()),
};}
for(const scenario of [
 {scope:'THIS_ONLY',linked:true,eventId:'e1'},
 {scope:'THIS_AND_FUTURE',linked:true,eventId:'e1'},
 {scope:'THIS_AND_FUTURE',linked:true,eventId:'e0'},
 {scope:'ALL_IN_SERIES',linked:true,eventId:'e1'},
 {scope:'THIS_AND_FUTURE',linked:false,eventId:'e1'},
 {scope:'ALL_IN_SERIES',linked:false,eventId:'e1'},
 {scope:'INVALID',linked:true,eventId:'e1'},
 {scope:'ALL_IN_SERIES',linked:true,eventId:'missing'},
 {scope:'ALL_IN_SERIES',linked:true,eventId:'e1',projection:true},
] as const)test(`actual deletion parity: ${JSON.stringify(scenario)}`,async()=>{
 let expected:unknown;
 const infoType=getNamedType(schema.getMutationType()!.getFields().deleteEvents.type) as GraphQLObjectType;
 const field=infoType.getFields().nodesDeleted,original=field.resolve;
 try {
  for(const repo of [baseline(),createEventSeriesDeletionRepository(driver)]){
   await resetDatabase(driver);await seed(scenario.linked);events=[];
   const nodes=(await driver.executeQuery('MATCH(n) RETURN toString(id(n)) AS identity,labels(n)[0] AS label,properties(n) AS properties')).records.map(r=>r.toObject());
   const rels=(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS identity,toString(id(a)) AS source,toString(id(b)) AS target,type(r) AS type')).records.map(r=>r.toObject());
   // First establish exact native read parity on the same allocated graph,
   // including the unsorted occurrence sequence consumed by production.
   assert.deepEqual(await createEventSeriesDeletionRepository(driver).findSnapshot(scenario.eventId),await baseline().findSnapshot(scenario.eventId));
   let observed:any;let calls=0;
   if('projection' in scenario)field.resolve=(source,args,context,info)=>{if(++calls===2)throw Error('fixture second delete projection failure');return original?original(source,args,context,info):source.nodesDeleted;};
   const repository={...repo,findSnapshot:async(id:string)=>{const rows=await repo.findSnapshot(id);
    // A partial failure must exercise an identical input sequence in both
    // runs. Fresh graph allocation does not promise the same native order.
    // Read parity above remains exact; real deletes and projection failure
    // below still run through the installed generated schema.
    if('projection' in scenario){const occurrences=rows[0].EventSeries!.Occurrences;rows[0].EventSeries!.Occurrences=['e2','e0','e1'].map(id=>{const occurrence=occurrences.find(o=>o.id===id);assert.ok(occurrence);return occurrence;});}
    observed=rows[0];return rows;}};
   const resolver=getResolver({driver,eventSeriesDeletionRepository:repository});let response:unknown,error:string|null=null;
   try{response=await resolver(null,scenario as never,{} as never,null as never);}catch(failure){error=(failure as Error).message;}
   field.resolve=original;
   let deleted:string[]=[];
   if(observed&&scenario.scope!=='INVALID'){
    const series=observed.EventSeries;
    if(scenario.scope==='THIS_ONLY'||!series)deleted=[scenario.eventId];
    else{
     const occurrences=series.Occurrences.filter((o:any)=>scenario.scope==='ALL_IN_SERIES'||(o.occurrenceIndex||0)>=(observed.occurrenceIndex||0));
     deleted=occurrences.map((o:any)=>o.id);
     if('projection' in scenario)deleted=deleted.slice(0,2);
     else if(scenario.scope==='ALL_IN_SERIES'||occurrences.length===series.Occurrences.length)deleted.push(series.id);
    }
   }
   if('projection' in scenario){assert.equal(error,'Failed to delete event in series. fixture second delete projection failure');assert.equal(calls,2);assert.deepEqual(deleted,['e2','e0']);}
   else if(!observed||scenario.scope==='INVALID')assert.ok(error);
   else assert.equal(error,null);
   // Native event groups must follow the actual snapshot's requested deletion
   // order. Each fixture occurrence has one relationship, so no sibling-order
   // normalization is needed or permitted within an operation.
   let cursor=0;const remaining=new Set(rels.map(r=>r.identity));const groups:any[]=[];
   const alias=(id:string)=>{const n=nodes.find(n=>n.identity===id);assert.ok(n);return n.properties.id;};
   for(const id of deleted){
    const node=nodes.find(n=>n.properties.id===id);assert.ok(node);const group:any[]=[];
    const event=events[cursor++];assert.equal(event.event,'delete');assert.equal(event.id,node.identity);assert.equal(event.typename,node.label);assert.deepEqual(plain(event.properties.old),plain(node.properties));assert.equal(event.properties.new,undefined);group.push(event);
    const incident=rels.filter(r=>remaining.has(r.identity)&&(r.source===node.identity||r.target===node.identity));assert.ok(incident.length<=1);
    for(const rel of incident){const edge=events[cursor++];assert.equal(edge.event,'delete_relationship');assert.equal(edge.id,rel.identity);assert.equal(edge.relationshipName,rel.type);assert.equal(edge.id_from,rel.source);assert.equal(edge.id_to,rel.target);remaining.delete(rel.identity);group.push(edge);}
    groups.push({id,events:JSON.parse(JSON.stringify(group,function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){if(key==='id'&&this.event==='delete_relationship'){const rel=rels.find(r=>r.identity===value)!;return rel.type+':'+alias(rel.target);}return alias(value);}return key==='timestamp'?'<time>':value;}))});
   }
   assert.equal(cursor,events.length);
   const current=await state();assert.deepEqual(current.nodes.map(n=>n.properties.id).sort(),nodes.map(n=>n.properties.id).filter(id=>!deleted.includes(id)).sort());
   // The ordered contract was checked above against the exact consumed read;
   // compare semantic groups across independently allocated fixture graphs.
   const actual={response,error,state:plain(current),groups:'projection' in scenario?groups:groups.sort((a,b)=>a.id.localeCompare(b.id))};
   if(expected)assert.deepEqual(actual,expected);else expected=actual;
  }
 }finally{field.resolve=original;}
});
test('snapshot keeps the generated nested default limit',async()=>{await seed(true,28);const old=await baseline().findSnapshot('e0');const next=await createEventSeriesDeletionRepository(driver).findSnapshot('e0');assert.deepEqual(next,old);assert.equal(next[0].EventSeries!.Occurrences.length,25);});
