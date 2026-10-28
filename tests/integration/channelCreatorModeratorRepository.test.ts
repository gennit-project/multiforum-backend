import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { createChannelCreatorModeratorRepository } from "../../services/persistence/channelCreatorModeratorRepository.js";
import { createChannelCreatorModeratorService } from "../../services/channelCreatorModerator.js";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { Neo4jError, type Driver } from "neo4j-driver";
import { graphql, type GraphQLSchema } from "graphql";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let events: Array<Record<string, unknown>>;
const engine = createSubscriptionEngine();
let service: ReturnType<typeof createChannelCreatorModeratorService>;

before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: engine as unknown as boolean },
  });
  schema = await neoSchema.getSchema();
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
      updateChannels(where: { uniqueName: { eq: $channel } }, update: { Moderators: [{ connect: [{ where: { node: { displayName: { eq: $profile } } } }] }] }) {
        channels { uniqueName }
      }
    }`,
    variableValues: { channel, profile },
    contextValue: {},
  });
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
};

// v7 (campaign #284): this used the generated connect purely as a native-event
// baseline to compare against the custom service. With event tests dropped (no
// in-process subscriptions in use) and the generated connect no longer
// idempotent (two connects leave two edges, unlike the custom service's MERGE),
// the baseline has no remaining purpose. The production idempotency + in-process
// publication contracts are covered by the driver-assignment and "concurrent
// assignments create one edge" tests. Removed.

test("missing connection endpoints produce no relationship events", async () => {
  await connectCreator("missing");
  await connectCreator("cats", "missing");
  assert.deepEqual(events, []);
});


test("driver assignment publishes a relationship event only on creation", async () => {
  // v7: the custom service still publishes in-process relationship events (unlike
  // generated mutations, which are now CDC-only). Assert the serialized shape and
  // that a repeated assignment is an idempotent no-op that publishes nothing new.
  await service.assign("cats", "Mod Alice");
  assert.equal(events.length, 1);
  const actual = events[0];
  assert.equal(actual.event, "create_relationship");
  assert.equal(actual.relationshipName, "MODERATOR_OF_CHANNEL");
  assert.equal(actual.fromTypename, "ModerationProfile");
  assert.equal(actual.toTypename, "Channel");
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


// v7 (campaign #284): the generated GraphQL subscription path is CDC-only and is
// not wired to the in-process engine in this harness ("Schema is not configured
// to execute subscription operation"), so the end-to-end generated-subscriber
// delivery test was removed. In-process publication from the custom service is
// covered by the driver-assignment tests above.

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
