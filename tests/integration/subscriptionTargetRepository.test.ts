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
  const legacy = () => ogm.model(item.model).find({ where: { id: "target" },
    selectionSet: `{ ${item.fields} ${item.property} { username } }` });
  test(`${item.method}: missing, populated and empty subscribers match production OGM`, async () => {
    assert.deepEqual(await repository[item.method]("target"), plain(await legacy()));
    await seed(item.model);
    assert.deepEqual(await repository[item.method]("target"), plain(await legacy()));
    await driver.executeQuery(`MATCH (n:${item.model} {id: 'target'})
      UNWIND range(1, 30) AS i CREATE (u:User {username: 'user' + toString(i)})
      CREATE (u)-[:${item.relation}]->(n)`);
    const expected = plain(await legacy());
    assert.equal(expected[0][item.property].length, 25);
    assert.deepEqual(await repository[item.method]("target"), expected);
  });
  test(`${item.method}: sensitive visibility and nullable fields match production OGM`, async () => {
    await seed(item.model);
    await driver.executeQuery(`MATCH (n:${item.model}) SET n.ageGateRestricted = true`);
    assert.deepEqual(await repository[item.method]("target"), plain(await legacy()));
    await driver.executeQuery(`MATCH (n:${item.model}) SET n.ageGateRestricted = false REMOVE n.text, n.description, n.archived`);
    assert.deepEqual(await repository[item.method]("target"), plain(await legacy()));
  });
  test(`${item.method}: malformed projection fails with the same first error`, async () => {
    await seed(item.model);
    await driver.executeQuery(`MATCH (n:${item.model}) REMOVE n.createdAt`);
    const message = await legacy().then(() => "NO ERROR", (error: Error) => error.message);
    assert.notEqual(message, "NO ERROR");
    await assert.rejects(repository[item.method]("target"), { message });
  });
}

for (const [field, values] of Object.entries({
  issueNumber: ["invalid", "42", 1.75, true, false, 0, "", [1, 2], ["invalid"]],
  title: [17, true, ["bad"]],
  createdAt: ["invalid", 42, "2026-01-01T00:00:00Z"],
})) {
  test(`issue malformed ${field} serialization matches the generated field resolver`, async () => {
    await seed("Issue");
    for (const value of values) {
      await driver.executeQuery(`MATCH (n:Issue) SET n.${field} = $value`, { value });
      const legacy = () => ogm.model("Issue").find({ where: { id: "target" },
        selectionSet: "{ id issueNumber title channelUniqueName createdAt SubscribedToNotifications { username } }" });
      const expected = await legacy().then(value => ({ value: plain(value) }), (error: Error) => ({ error: error.message }));
      const actual = await repository.findIssue("target").then(value => ({ value }), (error: Error) => ({ error: error.message }));
      assert.deepEqual(actual, expected, `${field}: ${JSON.stringify(value)}`);
    }
  });
}
test("nullable Issue channel name and malformed subscriber preserve results/errors", async () => {
  await seed("Issue");
  await driver.executeQuery("MATCH (n:Issue) REMOVE n.channelUniqueName CREATE (u:User)-[:SUBSCRIBED_TO_ISSUE]->(n)");
  const legacy = () => ogm.model("Issue").find({ where: { id: "target" },
    selectionSet: "{ id issueNumber title channelUniqueName createdAt SubscribedToNotifications { username } }" });
  const message = await legacy().then(() => "NO ERROR", (error: Error) => error.message);
  await assert.rejects(repository.findIssue("target"), { message });
  await driver.executeQuery("MATCH (u:User) SET u.username = 'subscriber'");
  assert.deepEqual(await repository.findIssue("target"), plain(await legacy()));
});

test("discussion ID projection retains generated numeric ID conversion", async () => {
  await seed("DiscussionChannel");
  for (const value of [1.75, 4, "id", true, [1, 2]]) {
    await driver.executeQuery("MATCH (n:DiscussionChannel) SET n.discussionId = $value", { value });
    const expected = await ogm.model("DiscussionChannel").find({ where: { id: "target" },
      selectionSet: "{ id discussionId channelUniqueName createdAt archived SubscribedToNotifications { username } }" })
      .then(value => ({ value: plain(value) }), (error: Error) => ({ error: error.message }));
    const actual = await repository.findDiscussionChannel("target")
      .then(value => ({ value }), (error: Error) => ({ error: error.message }));
    assert.deepEqual(actual, expected);
  }
});

test("discussion archived Boolean coercion matches generated response", async () => {
  await seed("DiscussionChannel");
  for (const value of ["bad", 1, 0, true, false]) {
    await driver.executeQuery("MATCH (n:DiscussionChannel) SET n.archived = $value", { value });
    const expected = await ogm.model("DiscussionChannel").find({ where: { id: "target" },
      selectionSet: "{ id discussionId channelUniqueName createdAt archived SubscribedToNotifications { username } }" })
      .then(value => ({ value: plain(value) }), (error: Error) => ({ error: error.message }));
    const actual = await repository.findDiscussionChannel("target")
      .then(value => ({ value }), (error: Error) => ({ error: error.message }));
    assert.deepEqual(actual, expected);
  }
});
test("duplicate roots and subscriber relationships retain multiplicity and validate all roots", async () => {
  await seed("Comment");
  await seed("Comment");
  await driver.executeQuery("CREATE (u:User {username:'subscriber'}) WITH u MATCH (n:Comment) CREATE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(n) CREATE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(n)");
  const legacy = () => ogm.model("Comment").find({ where: { id: "target" }, selectionSet: "{ id text createdAt SubscribedToNotifications { username } }" });
  assert.deepEqual(await repository.findComment("target"), plain(await legacy()));
  const actual = await repository.findComment("target");
  assert.equal(actual.length, 2);
  assert.equal(actual[0].SubscribedToNotifications?.length, 2);
  await driver.executeQuery("MATCH (n:Comment) WITH n LIMIT 1 REMOVE n.createdAt");
  const message = await legacy().then(() => "NO ERROR", (error: Error) => error.message);
  await assert.rejects(repository.findComment("target"), { message });
});

const actionPairs = [
  [subscribeToComment, unsubscribeFromComment],
  [subscribeToDiscussionChannel, unsubscribeFromDiscussionChannel],
  [subscribeToEvent, unsubscribeFromEvent],
  [subscribeToEventUpdates, unsubscribeFromEventUpdates],
  [subscribeToIssue, unsubscribeFromIssue],
] as const;
for (const [index, item] of cases.entries()) {
  test(`${item.method}: repeated subscribe/unsubscribe preserves writes and selected response`, async () => {
    await seed(item.model);
    await driver.executeQuery("CREATE (:User {username: 'actor'})");
    const [subscribe, unsubscribe] = actionPairs[index];
    const args = { commentId: "target", discussionChannelId: "target", eventId: "target", issueId: "target" };
    const context = { user: { username: "actor" } } as GraphQLContext;
    for (const action of [subscribe, subscribe, unsubscribe, unsubscribe]) {
      const result = await action({ driver, subscriptionTargetRepository: repository })(null, args, context, {} as GraphQLResolveInfo);
      const expected = await ogm.model(item.model).find({ where: { id: "target" },
        selectionSet: `{ ${item.fields} ${item.property} { username } }` });
      assert.deepEqual(result, plain(expected[0]));
      assert.equal(result?.[item.property]?.length, action === subscribe ? 1 : 0);
    }
  });
}
