import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {isInt, type Driver, type ManagedTransaction} from 'neo4j-driver';
import type {GraphQLSchema, GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../../customResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventSeriesCreationRepository, CREATED_EVENT_SERIES_SELECTION} from '../../services/persistence/eventSeriesCreationRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';
let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
let schema: GraphQLSchema;
let events: any[] = [];
const engine = createSubscriptionEngine();
for (const kind of ['create', 'update', 'create_relationship', 'delete_relationship']) engine.events.on(kind, event => events.push(event));
before(async () => {
  driver = await startNeo4j(); app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}, subscriptions: engine}});
  schema = await neo.getSchema(); initializeOgmFromExistingSchema(app.ogm, neo, schema); registerGeneratedSchema(driver, schema);
}, {timeout: 240000});
beforeEach(async () => {await resetDatabase(driver); events = [];});
after(async () => {await engine.close(); await stopNeo4j();});
const input = {title: 'Series', Occurrences: {create: [{node: {title: 'Occurrence', canceled: false, occurrenceIndex: 0, startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T12:00:00Z'}}]}};
const oldCreate = async (tx: ManagedTransaction, value: unknown) => (await app.ogm.model('EventSeries').create({input: [value] as never, selectionSet: `{eventSeries ${CREATED_EVENT_SERIES_SELECTION}}`, context: {executionContext: tx}})).eventSeries;
const newCreate = (tx: ManagedTransaction, value: unknown) => createEventSeriesCreationRepository(driver).createWithinTransaction(value as never, tx);

// Native generated events convert integer properties to JavaScript numbers.
// Compare the same exact safe values; keep temporal objects and raw IDs checked.
const propertyValues = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (!isInt(item)) return item;
  assert.ok(item.inSafeRange());
  return item.toNumber();
}));
// Check actual identities and properties before replacing per-run generated IDs.
async function capture(tx: ManagedTransaction, response: unknown) {
  const nodes = (await tx.run('MATCH(n) RETURN toString(id(n)) AS id, labels(n)[0] AS label, properties(n) AS properties')).records;
  const rels = (await tx.run('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS id, toString(id(a)) AS source, toString(id(b)) AS target, type(r) AS type')).records;
  assert.equal(nodes.length, 2); assert.equal(rels.length, 1); assert.equal(events.length, 3);
  const nodeAliases = new Map(nodes.map(n => [n.get('id'), n.get('label')]));
  const domainAliases = new Map(nodes.map(n => [n.get('properties').id, n.get('label') + '-domain-id']));
  for (const event of events) {
    if (event.event === 'create') {
      const node = nodes.find(n => n.get('id') === event.id);
      assert.ok(node); assert.equal(event.typename, node.get('label'));
      assert.equal(event.properties.old, undefined);
      assert.deepEqual(propertyValues(event.properties.new), propertyValues(node.get('properties')));
      assert.equal(event.properties.new.createdAt.toStandardDate().getTime(), event.timestamp);
    } else {
      assert.equal(event.event, 'create_relationship');
      const rel = rels.find(r => r.get('id') === event.id); assert.ok(rel);
      assert.equal(event.relationshipName, rel.get('type'));
      assert.equal(event.id_from, rel.get('source')); assert.equal(event.id_to, rel.get('target'));
    }
  }
  return JSON.parse(JSON.stringify({response, events}, function(key, value) {
    if (this.event && ['id', 'id_from', 'id_to'].includes(key)) {
      if (key === 'id' && this.event === 'create_relationship') return 'occurrence-relationship';
      assert.ok(nodeAliases.has(value)); return nodeAliases.get(value);
    }
    if (domainAliases.has(value)) return domainAliases.get(value);
    return ['createdAt', 'timestamp'].includes(key) ? '<time>' : value;
  }));
}
for (const mode of ['commit', 'rollback', 'projection failure']) test(`nested series creation preserves ${mode}, graph and native events`, async () => {
  const field = (schema.getType('EventSeries') as GraphQLObjectType).getFields().title;
  const original = field.resolve;
  if (mode === 'projection failure') field.resolve = () => {throw Error('fixture projection failure');};
  try {
    let expected: unknown;
    for (const create of [oldCreate, newCreate]) {
      await resetDatabase(driver); events = [];
      const session = driver.session(); let actual: unknown; let createdId = '';
      try {
        const operation = session.executeWrite(async tx => {
          let response: unknown;
          try {const created = await create(tx, input); response = created; createdId = created[0].id;}
          finally {actual = await capture(tx, response);}
          if (mode === 'rollback') throw Error('fixture rollback');
        });
        if (mode === 'commit') await operation;
        else await assert.rejects(operation, {message: 'fixture ' + mode});
      } finally {await session.close();}
      assert.equal((await driver.executeQuery('MATCH(n) RETURN count(n) AS n')).records[0].get('n').toNumber(), mode === 'commit' ? 2 : 0);
      if (mode === 'commit') assert.deepEqual(await createEventSeriesCreationRepository(driver).findCreatedSeries(createdId), await app.ogm.model('EventSeries').find({where: {id: createdId}, selectionSet: CREATED_EVENT_SERIES_SELECTION}));
      if (expected) assert.deepEqual(actual, expected); else expected = actual;
    }
  } finally {field.resolve = original;}
});
test('missing series and invalid nested input preserve empty results, errors and no writes', async () => {
  assert.deepEqual(await createEventSeriesCreationRepository(driver).findCreatedSeries('missing'), []);
  let message = '';
  for (const create of [oldCreate, newCreate]) {
    const session = driver.session();
    try {await assert.rejects(session.executeWrite(tx => create(tx, {...input, title: 123})), error => {
      if (!message) message = (error as Error).message;
      assert.equal((error as Error).message, message); return true;
    });} finally {await session.close();}
    assert.deepEqual(events, []);
    assert.equal((await driver.executeQuery('MATCH(n) RETURN count(n) AS n')).records[0].get('n').toNumber(), 0);
  }
});
