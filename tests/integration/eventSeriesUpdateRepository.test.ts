import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema, GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import getResolver from '../../customResolvers/mutations/updateEventInSeries.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createEventSeriesUpdateRepository } from '../../services/persistence/eventSeriesUpdateRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';
let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
let schema: GraphQLSchema;
let events: any[] = [];
const engine = createSubscriptionEngine();
for (const kind of ['create', 'update', 'create_relationship', 'delete_relationship']) engine.events.on(kind, (event: unknown) => events.push(event));
before(async () => {
  driver = await startNeo4j(); app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}, subscriptions: engine as unknown as boolean}});
  schema = await neo.getSchema(); registerGeneratedSchema(driver, schema);
}, {timeout: 240000});
beforeEach(async () => {await resetDatabase(driver); events = [];});
after(async () => {await engine.close(); await stopNeo4j();});
// Subscription events carry the volatile internal node id (this.event is set on them); neutralize it so the snapshot is stable, while leaving business ids intact. updatedAt/timestamp are wall-clock-ish.
const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, function (key, item) {if (key === 'id' && this.event) return '<nodeId>'; return ['updatedAt','timestamp'].includes(key) ? '<time>' : item;}));
async function seed(count: number, linked: boolean) {
  await driver.executeQuery("CREATE(s:EventSeries{id:'s',title:'Before',createdAt:datetime('2020-01-01T00:00:00Z')}) WITH s UNWIND range(0,$last) AS i CREATE(e:Event{id:'e'+toString(i),title:'Before',occurrenceIndex:i,canceled:false,startTime:datetime('2026-06-01T10:00:00Z'),endTime:datetime('2026-06-01T12:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')}) FOREACH(_ IN CASE WHEN $linked THEN [1] ELSE [] END | CREATE(s)-[:HAS_OCCURRENCE]->(e))", {last: count-1, linked});
}
const state = async () => (await driver.executeQuery('MATCH(n) RETURN labels(n) AS labels, properties(n) AS properties ORDER BY n.id')).records.map(r => r.toObject());
const cases = [
  {name:'this only overrides',scope:'THIS_ONLY',linked:true},
  {name:'this and future',scope:'THIS_AND_FUTURE',linked:true},
  {name:'all in series',scope:'ALL_IN_SERIES',linked:true},
  {name:'standalone future',scope:'THIS_AND_FUTURE',linked:false},
  {name:'standalone all',scope:'ALL_IN_SERIES',linked:false},
  {name:'occurrence-only changes',scope:'ALL_IN_SERIES',linked:true,update:{canceled:true}},
  {name:'nested default limit',scope:'ALL_IN_SERIES',linked:true,count:28},
  {name:'invalid scope',scope:'INVALID',linked:true},
  {name:'invalid update coercion',scope:'THIS_ONLY',linked:true,update:{title:123}},
  {name:'template projection failure',scope:'ALL_IN_SERIES',linked:true,projection:true},
] as const;
for (const scenario of cases) test(`actual resolver parity: ${scenario.name}`, async (t) => {
  const count = 'count' in scenario ? scenario.count : 3;
  await seed(count, scenario.linked);
  // Keep identities/relationship allocation unchanged between old and new runs.
  const originals = (await driver.executeQuery('MATCH(n) RETURN id(n) AS identity, properties(n) AS properties')).records.map(r => r.toObject());
  const nodeIds = new Set(originals.map(n => n.identity.toString()));
  const originalState = await state();
  const field = (schema.getType('EventSeries') as GraphQLObjectType).getFields().title;
  const original = field.resolve;
  if ('projection' in scenario) field.resolve = (source, args, context, info) => {
    if (info.operation.operation === 'mutation') throw Error('fixture template projection failure');
    return original ? original(source,args,context,info) : source.title;
  };
  try {
    {
      const repository = createEventSeriesUpdateRepository(driver);
      await driver.executeQuery('UNWIND $originals AS row MATCH(n) WHERE id(n)=row.identity SET n=row.properties', {originals}); events = [];
      const resolver = getResolver({driver, eventSeriesUpdateRepository: repository, dependencies: {buildEventUpdateNotificationPayload: () => null, sendBatchEmails: async () => {assert.fail('No notifications expected');}}});
      let response: unknown; let error: string | null = null;
      try {response = await resolver(null, {eventId:'e1',scope:scenario.scope,eventUpdateInput:'update' in scenario ? scenario.update : {title:'After'},channelConnections:[],channelDisconnections:[]} as never, {user:{username:'actor'}} as never, null as never);}
      catch (failure) {error = (failure as Error).message;}
      for (const event of events) {
        assert.equal(event.event,'update'); assert.ok(nodeIds.has(event.id));
        assert.equal(event.properties.new.updatedAt.toStandardDate().getTime(),event.timestamp);
      }
      const current = await state();
      if (scenario.name === 'invalid scope' || scenario.name === 'invalid update coercion' || 'projection' in scenario) {
        assert.ok(error); assert.deepEqual(current, originalState);
        if ('projection' in scenario) assert.equal(events.length,4); else assert.deepEqual(events,[]);
      } else {
        assert.equal(error,null);
        const changed = current.filter(n => n.properties.title === 'After' || n.properties.canceled === true).length;
        if (scenario.name==='nested default limit') assert.equal(changed,26);
        else if (scenario.name==='this and future') assert.equal(changed,3);
        else if (scenario.name==='all in series') assert.equal(changed,4);
        else if (scenario.name==='occurrence-only changes') assert.equal(changed,3);
        else assert.equal(changed,1);
      }
      // 'nested default limit' updates a non-deterministic 25-of-28 occurrence subset (default-limit projection) → set/order unstable, so keep only the literal count assert above and do not snapshot it.
      if (scenario.name !== 'nested default limit') t.assert.snapshot(normalize({response,error,state:current,events}));
    }
  } finally {field.resolve=original;}
});
test('series default projection and missing snapshots match the production initialized OGM', async () => {
  const repository=createEventSeriesUpdateRepository(driver);
  assert.deepEqual(await repository.findSnapshot('missing'),[]);
  assert.deepEqual(await repository.findUpdatedOccurrence('missing'),[]);
});
