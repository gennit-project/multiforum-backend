import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {isInt, type Driver, type ManagedTransaction} from 'neo4j-driver';
import type {GraphQLSchema, GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventSeriesCreationRepository} from '../../services/persistence/eventSeriesCreationRepository.js';
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
const input = {title: 'Series', Occurrences: {create: [{node: {title: 'Occurrence', canceled: false, occurrenceIndex: 0, startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T12:00:00Z'}}]}};
const newCreate =(tx: ManagedTransaction, value: unknown) => createEventSeriesCreationRepository(driver).createWithinTransaction(value as never, tx);

// Native generated events convert integer properties to JavaScript numbers.
// Compare the same exact safe values; keep temporal objects and raw IDs checked.
const propertyValues = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (!isInt(item)) return item;
  assert.ok(item.inSafeRange());
  return item.toNumber();
}));
// Generated series carry a per-run UUID id and a wall-clock createdAt; replace those before snapshotting.
const normSeries = (value: unknown) => JSON.parse(JSON.stringify(propertyValues(value), (key, item) => (['id', 'createdAt', 'updatedAt', 'timestamp'].includes(key) && item !== null ? `<${key}>` : item)));
// Check actual identities and properties before replacing per-run generated IDs.
// v7 (campaign #284) emits no in-process subscription events, so the native
// create / create_relationship event assertions are removed; the committed
// graph (2 nodes + 1 relationship) and the generated response stay asserted.
async function capture(tx: ManagedTransaction, response: unknown) {
  const nodes = (await tx.run('MATCH(n) RETURN toString(id(n)) AS id, labels(n)[0] AS label, properties(n) AS properties')).records;
  const rels = (await tx.run('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS id, toString(id(a)) AS source, toString(id(b)) AS target, type(r) AS type')).records;
  assert.equal(nodes.length, 2); assert.equal(rels.length, 1);
  const domainAliases = new Map(nodes.map(n => [n.get('properties').id, n.get('label') + '-domain-id']));
  return JSON.parse(JSON.stringify({response}, function(key, value) {
    if (domainAliases.has(value)) return domainAliases.get(value);
    return ['createdAt', 'updatedAt', 'timestamp'].includes(key) ? '<time>' : value;
  }));
}
for (const mode of ['commit', 'rollback', 'projection failure']) test(`nested series creation preserves ${mode}, graph and native events`, async (t) => {
  const field = (schema.getType('EventSeries') as GraphQLObjectType).getFields().title;
  const original = field.resolve;
  if (mode === 'projection failure') field.resolve = () => {throw Error('fixture projection failure');};
  try {
    await resetDatabase(driver); events = [];
    const session = driver.session(); let actual: unknown; let createdId = '';
    try {
      const operation = session.executeWrite(async tx => {
        let response: unknown;
        try {const created = await newCreate(tx, input); response = created; createdId = created[0].id;}
        finally {actual = await capture(tx, response);}
        if (mode === 'rollback') throw Error('fixture rollback');
      });
      if (mode === 'commit') await operation;
      else await assert.rejects(operation, {message: 'fixture ' + mode});
    } finally {await session.close();}
    assert.equal((await driver.executeQuery('MATCH(n) RETURN count(n) AS n')).records[0].get('n').toNumber(), mode === 'commit' ? 2 : 0);
    if (mode === 'commit') t.assert.snapshot(normSeries(await createEventSeriesCreationRepository(driver).findCreatedSeries(createdId)));
    t.assert.snapshot(actual);
  } finally {field.resolve = original;}
});
test('missing series and invalid nested input preserve empty results, errors and no writes', async () => {
  assert.deepEqual(await createEventSeriesCreationRepository(driver).findCreatedSeries('missing'), []);
  const session = driver.session();
  try {await assert.rejects(session.executeWrite(tx => newCreate(tx, {...input, title: 123})), /String cannot represent a non string value/);} finally {await session.close();}
  assert.equal((await driver.executeQuery('MATCH(n) RETURN count(n) AS n')).records[0].get('n').toNumber(), 0);
});
