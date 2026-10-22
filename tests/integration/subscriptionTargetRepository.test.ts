import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import subscribeToComment from "../../customResolvers/mutations/subscribeToComment.js";
import unsubscribeFromComment from "../../customResolvers/mutations/unsubscribeFromComment.js";
import subscribeToDiscussionChannel from "../../customResolvers/mutations/subscribeToDiscussionChannel.js";
import unsubscribeFromDiscussionChannel from "../../customResolvers/mutations/unsubscribeFromDiscussionChannel.js";
import subscribeToEvent from "../../customResolvers/mutations/subscribeToEvent.js";
import unsubscribeFromEvent from "../../customResolvers/mutations/unsubscribeFromEvent.js";
import subscribeToEventUpdates from "../../customResolvers/mutations/subscribeToEventUpdates.js";
import unsubscribeFromEventUpdates from "../../customResolvers/mutations/unsubscribeFromEventUpdates.js";
import subscribeToIssue from "../../customResolvers/mutations/subscribeToIssue.js";
import unsubscribeFromIssue from "../../customResolvers/mutations/unsubscribeFromIssue.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { createSubscriptionTargetRepository } from "../../services/persistence/subscriptionTargetRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let repository: ReturnType<typeof createSubscriptionTargetRepository>;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  initializeOgmFromExistingSchema(ogm, neoSchema, await neoSchema.getSchema());
  repository = createSubscriptionTargetRepository(driver);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const cases = [
  { model: "Comment", method: "findComment", fields: "id text createdAt", relation: "SUBSCRIBED_TO_NOTIFICATIONS", property: "SubscribedToNotifications" },
  { model: "DiscussionChannel", method: "findDiscussionChannel", fields: "id discussionId channelUniqueName createdAt archived", relation: "SUBSCRIBED_TO_NOTIFICATIONS", property: "SubscribedToNotifications" },
  { model: "Event", method: "findEvent", fields: "id title description createdAt", relation: "SUBSCRIBED_TO_NOTIFICATIONS", property: "SubscribedToNotifications" },
  { model: "Event", method: "findEventUpdates", fields: "id title createdAt", relation: "SUBSCRIBED_TO_EVENT_UPDATES", property: "SubscribedToEventUpdates" },
  { model: "Issue", method: "findIssue", fields: "id issueNumber title channelUniqueName createdAt", relation: "SUBSCRIBED_TO_ISSUE", property: "SubscribedToNotifications" },
] as const;
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
const seed = async (label: string) => driver.executeQuery(`CREATE (n:${label} {
  id: 'target', discussionId: 'discussion', channelUniqueName: 'channel',
  issueNumber: 4, title: 'title', text: 'text', description: 'description', archived: false,
  createdAt: datetime('2026-10-20T01:02:03.123456+02:00')
})`);

for (const item of cases) {
  test(`${item.method}: missing, populated and empty subscribers match production OGM`, async (t) => {
    t.assert.snapshot(await repository[item.method]("target"));
    await seed(item.model);
    t.assert.snapshot(await repository[item.method]("target"));
    await driver.executeQuery(`MATCH (n:${item.model} {id: 'target'})
      UNWIND range(1, 30) AS i CREATE (u:User {username: 'user' + toString(i)})
      CREATE (u)-[:${item.relation}]->(n)`);
    // The generated nested-connection projection applies a default limit of 25 over the
    // subscriber relationship; which 25 of the 30 are returned (and their order) is only
    // stable within a single run, so snapshot the projection with subscribers reduced to a
    // count and assert the limit separately.
    const rows = plain(await repository[item.method]("target"));
    assert.equal(rows[0][item.property].length, 25);
    t.assert.snapshot(rows.map((row: Record<string, unknown>) => ({ ...row, [item.property]: (row[item.property] as unknown[]).length })));
  });
  test(`${item.method}: sensitive visibility and nullable fields match production OGM`, async (t) => {
    await seed(item.model);
    await driver.executeQuery(`MATCH (n:${item.model}) SET n.ageGateRestricted = true`);
    t.assert.snapshot(await repository[item.method]("target"));
    await driver.executeQuery(`MATCH (n:${item.model}) SET n.ageGateRestricted = false REMOVE n.text, n.description, n.archived`);
    t.assert.snapshot(await repository[item.method]("target"));
  });
  test(`${item.method}: malformed projection fails with the same first error`, async () => {
    await seed(item.model);
    await driver.executeQuery(`MATCH (n:${item.model}) REMOVE n.createdAt`);
    await assert.rejects(repository[item.method]("target"), /Cannot return null for non-nullable field \w+\.createdAt/);
  });
}

for (const [field, values] of Object.entries({
  issueNumber: ["invalid", "42", 1.75, true, false, 0, "", [1, 2], ["invalid"]],
  title: [17, true, ["bad"]],
  createdAt: ["invalid", 42, "2026-01-01T00:00:00Z"],
})) {
  test(`issue malformed ${field} serialization matches the generated field resolver`, async (t) => {
    await seed("Issue");
    for (const value of values) {
      await driver.executeQuery(`MATCH (n:Issue) SET n.${field} = $value`, { value });
      const actual = await repository.findIssue("target").then(value => ({ value }), (error: Error) => ({ error: error.message }));
      t.assert.snapshot(actual);
    }
  });
}
test("nullable Issue channel name and malformed subscriber preserve results/errors", async (t) => {
  await seed("Issue");
  await driver.executeQuery("MATCH (n:Issue) REMOVE n.channelUniqueName CREATE (u:User)-[:SUBSCRIBED_TO_ISSUE]->(n)");
  await assert.rejects(repository.findIssue("target"), /Cannot return null for non-nullable field User\.username/);
  await driver.executeQuery("MATCH (u:User) SET u.username = 'subscriber'");
  t.assert.snapshot(await repository.findIssue("target"));
});

test("discussion ID projection retains generated numeric ID conversion", async (t) => {
  await seed("DiscussionChannel");
  for (const value of [1.75, 4, "id", true, [1, 2]]) {
    await driver.executeQuery("MATCH (n:DiscussionChannel) SET n.discussionId = $value", { value });
    const actual = await repository.findDiscussionChannel("target")
      .then(value => ({ value }), (error: Error) => ({ error: error.message }));
    t.assert.snapshot(actual);
  }
});

test("discussion archived Boolean coercion matches generated response", async (t) => {
  await seed("DiscussionChannel");
  for (const value of ["bad", 1, 0, true, false]) {
    await driver.executeQuery("MATCH (n:DiscussionChannel) SET n.archived = $value", { value });
    const actual = await repository.findDiscussionChannel("target")
      .then(value => ({ value }), (error: Error) => ({ error: error.message }));
    t.assert.snapshot(actual);
  }
});
test("duplicate roots and subscriber relationships retain multiplicity and validate all roots", async (t) => {
  await seed("Comment");
  await seed("Comment");
  await driver.executeQuery("CREATE (u:User {username:'subscriber'}) WITH u MATCH (n:Comment) CREATE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(n) CREATE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(n)");
  t.assert.snapshot(await repository.findComment("target"));
  const actual = await repository.findComment("target");
  assert.equal(actual.length, 2);
  assert.equal(actual[0].SubscribedToNotifications?.length, 2);
  await driver.executeQuery("MATCH (n:Comment) WITH n LIMIT 1 REMOVE n.createdAt");
  await assert.rejects(repository.findComment("target"), /Cannot return null for non-nullable field Comment\.createdAt/);
});

const actionPairs = [
  [subscribeToComment, unsubscribeFromComment],
  [subscribeToDiscussionChannel, unsubscribeFromDiscussionChannel],
  [subscribeToEvent, unsubscribeFromEvent],
  [subscribeToEventUpdates, unsubscribeFromEventUpdates],
  [subscribeToIssue, unsubscribeFromIssue],
] as const;
for (const [index, item] of cases.entries()) {
  test(`${item.method}: repeated subscribe/unsubscribe preserves writes and selected response`, async (t) => {
    await seed(item.model);
    await driver.executeQuery("CREATE (:User {username: 'actor'})");
    const [subscribe, unsubscribe] = actionPairs[index];
    const args = { commentId: "target", discussionChannelId: "target", eventId: "target", issueId: "target" };
    const context = { user: { username: "actor" } } as GraphQLContext;
    for (const action of [subscribe, subscribe, unsubscribe, unsubscribe]) {
      const result = await action({ driver, subscriptionTargetRepository: repository })(null, args, context, {} as GraphQLResolveInfo);
      t.assert.snapshot(result);
      assert.equal(result?.[item.property]?.length, action === subscribe ? 1 : 0);
    }
  });
}
