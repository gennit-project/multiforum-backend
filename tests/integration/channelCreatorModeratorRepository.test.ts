import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { createChannelCreatorModeratorRepository } from "../../services/persistence/channelCreatorModeratorRepository.js";
import { createChannelCreatorModeratorService } from "../../services/channelCreatorModerator.js";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { Neo4jError, type Driver } from "neo4j-driver";
import { subscribe, parse, graphql, type GraphQLSchema } from "graphql";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let events: Array<Record<string, unknown>>;
const engine = createSubscriptionEngine();
let service: ReturnType<typeof createChannelCreatorModeratorService>;

before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: engine },
  });
  schema = await neoSchema.getSchema();
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
  service = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(driver), engine);
  engine.events.on("create_relationship", (event: Record<string, unknown>) => {
    events.push(event);
  });
}, { timeout: 240_000 });

beforeEach(async () => {
  events = [];
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (:Channel {uniqueName: "cats", createdAt: datetime()})
    CREATE (:ModerationProfile {displayName: "Mod Alice", createdAt: datetime(), small: 42, large: 9223372036854775807, tags: [1, 2]})
  `);
});
after(async () => stopNeo4j());

// The generated-schema mutation that emits the MODERATOR_OF_CHANNEL relationship event, used as
// the native-event source/baseline (re-expressed off the live OGM onto the installed schema).
const connectCreator = async (channel = "cats", profile = "Mod Alice") => {
  const result = await graphql({
    schema,
    source: `mutation Connect($channel: String!, $profile: String!) {
      updateChannels(where: { uniqueName: $channel }, update: { Moderators: [{ connect: [{ where: { node: { displayName: $profile } } }] }] }) {
        channels { uniqueName }
      }
    }`,
    variableValues: { channel, profile },
    contextValue: {},
  });
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
};

test("production publishes moderator relationship events for both first and repeated connects", async () => {
  await connectCreator();
  assert.equal(events.length, 1);
  const first = events[0];
  assert.equal(first.event, "create_relationship");
  assert.equal(first.relationshipName, "MODERATOR_OF_CHANNEL");
  assert.equal(first.fromTypename, "ModerationProfile");
  assert.equal(first.toTypename, "Channel");
  await connectCreator();
  assert.equal(events.length, 2);
  assert.equal(events[1].id, first.id);
  const graph = await driver.executeQuery(`
    MATCH (:ModerationProfile)-[edge:MODERATOR_OF_CHANNEL]->(:Channel)
    RETURN count(edge) AS count
  `);
  assert.equal(graph.records[0].get("count").toNumber(), 1);
});

test("missing connection endpoints produce no relationship events", async () => {
  await connectCreator("missing");
  await connectCreator("cats", "missing");
  assert.deepEqual(events, []);
});


test("driver assignment publishes only on creation, with the same serialized event as generated mutations", async () => {
  await connectCreator();
  const expected = events[0];
  await driver.executeQuery("MATCH ()-[edge:MODERATOR_OF_CHANNEL]->() DELETE edge");
  events = [];
  await service.assign("cats", "Mod Alice");
  assert.equal(events.length, 1);
  const actual = events[0];
  assert.deepEqual({ ...actual, id: expected.id, timestamp: expected.timestamp }, expected);
  await service.assign("cats", "Mod Alice");
  assert.equal(events.length, 1);
});

test("concurrent assignments create one edge and publish one event", async () => {
  await Promise.all(Array.from({ length: 8 }, () => service.assign("cats", "Mod Alice")));
  assert.equal(events.length, 1);
  const result = await driver.executeQuery("MATCH ()-[edge:MODERATOR_OF_CHANNEL]->() RETURN count(edge) AS count");
  assert.equal(result.records[0].get("count").toNumber(), 1);
});

test("missing endpoints are silent no-ops for driver assignment", async () => {
  await service.assign("missing", "Mod Alice");
  await service.assign("cats", "missing");
  assert.deepEqual(events, []);
});

test("publication occurs after commit and survives a publisher failure", async () => {
  let observed = false;
  const assignment = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(driver), {
    async publish() {
      const check = await driver.executeQuery("MATCH ()-[edge:MODERATOR_OF_CHANNEL]->() RETURN count(edge) AS count");
      observed = check.records[0].get("count").toNumber() === 1;
      throw new Error("publisher unavailable");
    },
  });
  await assignment.assign("cats", "Mod Alice");
  // Publication is deliberately non-blocking; wait for this test publisher.
  for (let i = 0; i < 100 && !observed; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(observed, true);
  await assignment.assign("cats", "Mod Alice");
});


test("generated GraphQL subscribers receive both generated and driver relationship events", { timeout: 20_000 }, async () => {
  const stream = await subscribe({ schema, document: parse("subscription { channelRelationshipCreated { relationshipFieldName } }"), contextValue: {} });
  assert.ok(Symbol.asyncIterator in stream, JSON.stringify(stream));
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const first = iterator.next();
    await connectCreator();
    assert.deepEqual(JSON.parse(JSON.stringify((await first).value)), { data: { channelRelationshipCreated: { relationshipFieldName: "Moderators" } } });
    await driver.executeQuery("MATCH ()-[edge:MODERATOR_OF_CHANNEL]->() DELETE edge");
    const second = iterator.next();
    await service.assign("cats", "Mod Alice");
    assert.deepEqual(JSON.parse(JSON.stringify((await second).value)), { data: { channelRelationshipCreated: { relationshipFieldName: "Moderators" } } });
  } finally { await iterator.return?.(); }
});

// Inject a failure after the real MERGE while keeping actual driver-managed
// transaction rollback and retry. This never changes the shared driver.
function driverWithTransactionFailure(retry: boolean) {
  let attempts = 0;
  const wrapped = {
    executeQueryBookmarkManager: driver.executeQueryBookmarkManager,
    session: (...args: Parameters<Driver["session"]>) => {
      const session = driver.session(...args);
      const executeWrite = session.executeWrite.bind(session);
      session.executeWrite = (work) => executeWrite(async (tx) => {
        const value = await work(tx);
        attempts++;
        assert.equal(events.length, 0, "cannot publish before commit");
        if (!retry || attempts === 1) {
          if (retry) throw new Neo4jError("injected retry", "Neo.TransientError.Transaction.DeadlockDetected", "50N42", "injected transient failure");
          throw new Error("injected rollback");
        }
        return value;
      });
      return session;
    },
  } as Driver;
  return { wrapped, attempts: () => attempts };
}

test("rolled-back writes publish nothing and create no relationship", async () => {
  const { wrapped } = driverWithTransactionFailure(false);
  const assignment = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(wrapped), engine);
  await assert.rejects(assignment.assign("cats", "Mod Alice"), /injected rollback/);
  assert.deepEqual(events, []);
  const check = await driver.executeQuery("MATCH ()-[edge:MODERATOR_OF_CHANNEL]->() RETURN count(edge) AS count");
  assert.equal(check.records[0].get("count").toNumber(), 0);
});

test("driver retries a rolled-back write and publishes once after final commit", async () => {
  const state = driverWithTransactionFailure(true);
  const assignment = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(state.wrapped), engine);
  await assignment.assign("cats", "Mod Alice");
  assert.equal(state.attempts(), 2);
  assert.equal(events.length, 1);
});
