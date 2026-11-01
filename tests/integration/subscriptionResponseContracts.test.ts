import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
import type { SubscriptionMutationName } from "../../customResolvers/contracts/subscriptions.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  secured = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => resetDatabase(driver));
const cases = [
  { kind: "Comment", label: "Comment", argument: "commentId", fields: "id text createdAt", nullable: ["text"], property: "SubscribedToNotifications", relation: "SUBSCRIBED_TO_NOTIFICATIONS" },
  { kind: "DiscussionChannel", label: "DiscussionChannel", argument: "discussionChannelId", fields: "id discussionId channelUniqueName createdAt archived", nullable: ["archived"], property: "SubscribedToNotifications", relation: "SUBSCRIBED_TO_NOTIFICATIONS" },
  { kind: "Event", label: "Event", argument: "eventId", fields: "id title description createdAt", nullable: ["description"], property: "SubscribedToNotifications", relation: "SUBSCRIBED_TO_NOTIFICATIONS" },
  { kind: "EventUpdates", label: "Event", argument: "eventId", fields: "id title createdAt", nullable: [], property: "SubscribedToEventUpdates", relation: "SUBSCRIBED_TO_EVENT_UPDATES" },
  { kind: "Issue", label: "Issue", argument: "issueId", fields: "id issueNumber title channelUniqueName createdAt", nullable: ["title", "channelUniqueName"], property: "SubscribedToNotifications", relation: "SUBSCRIBED_TO_ISSUE" },
] as const;
type Case = typeof cases[number];
const time = "2026-01-02T03:04:05.000Z";
async function seed(item: Case) {
  await driver.executeQuery(`CREATE (:User {username:'actor',createdAt:datetime()}), (n:${item.label} {
    id:'target',createdAt:datetime($time),text:'Text',title:'Title',description:'Description',
    discussionId:'discussion',channelUniqueName:'forum',archived:false,issueNumber:4})`, { time });
}
function operation(item: Case, undo = false): SubscriptionMutationName {
  return undo ? `unsubscribeFrom${item.kind}` : `subscribeTo${item.kind}`;
}
function execute(item: Case, undo = false, id = "target", authenticated = true, protect = true) {
  return graphql({ schema: protect ? secured : schema,
    source: `mutation Subscription($id:ID!){target:${operation(item, undo)}(${item.argument}:$id){${item.fields} ${item.property}{username}}}`,
    variableValues: { id }, contextValue: { driver, req: { headers: {} }, user: authenticated ? { username: "actor", email: null, email_verified: true, data: null } : undefined, mayAccessSensitiveContent: false } });
}
async function count(item: Case) {
  const row = (await driver.executeQuery(`MATCH (:User {username:'actor'})-[r:${item.relation}]->(:${item.label}) RETURN count(r) AS count`)).records[0];
  return Number(row.get("count"));
}
function output(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data)).target;
}
async function link(item: Case) {
  await driver.executeQuery(`MATCH (u:User {username:'actor'}),(n:${item.label}) MERGE (u)-[:${item.relation}]->(n)`);
}

// Inject failures only at the selected driver method, retaining actual sessions
// and actual writes/reads everywhere else. No production adapter changes.
function faultDriver(failure: "write" | "read") {
  return new Proxy(driver, {
    get(target, key) {
      if (key === "session") return (...args: Parameters<Driver["session"]>) => {
        const session = target.session(...args);
        return new Proxy(session, { get(actual, method) {
          if (method === (failure === "write" ? "run" : "executeRead")) return async () => { throw new Error(`injected ${failure} failure`); };
          const value = Reflect.get(actual, method);
          return typeof value === "function" ? value.bind(actual) : value;
        } });
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
for (const item of cases) {
  test(`${item.kind}: both mutations serialize populated/empty subscribers and repeat operations`, async () => {
    await seed(item);
    for (const [undo, expected] of [[true, 0], [false, 1], [false, 1], [true, 0], [true, 0]] as const) {
      const target = output(await execute(item, undo));
      const expectedFields: Record<string, unknown> = { id: "target", createdAt: time, text: "Text", title: "Title", description: "Description", discussionId: "discussion", channelUniqueName: "forum", archived: false, issueNumber: 4 };
      for (const field of item.fields.split(" ")) assert.equal(target[field], expectedFields[field]);
      assert.deepEqual(target[item.property], expected ? [{ username: "actor" }] : []);
      assert.equal(await count(item), expected);
      assert.deepEqual(Object.keys(target).sort(), [...item.fields.split(" "), item.property].sort());
    }
  });
  test(`${item.kind}: subscriber cap remains 25 after both writes`, async () => {
    await seed(item);
    await driver.executeQuery(`MATCH (n:${item.label}) UNWIND range(1,30) AS i CREATE (:User {username:'user'+toString(i)})-[:${item.relation}]->(n)`);
    for (const undo of [false, true]) {
      assert.equal(output(await execute(item, undo))[item.property].length, 25);
      assert.equal(await count(item), undo ? 0 : 1);
    }
  });
  test(`${item.kind}: missing targets and selected nullable fields remain valid GraphQL results`, async () => {
    await seed(item);
    for (const undo of [false, true]) assert.equal(output(await execute(item, undo, "missing")), null);
    for (const field of item.nullable) await driver.executeQuery(`MATCH (n:${item.label}) REMOVE n.${field}`);
    for (const undo of [false, true]) {
      const target = output(await execute(item, undo));
      for (const field of item.nullable) assert.equal(target[field], null);
    }
  });
  test(`${item.kind}: both mutations require authentication before writing`, async () => {
    await seed(item);
    for (const undo of [false, true]) assert.ok((await execute(item, undo, "target", false)).errors);
    assert.equal(await count(item), 0);
  });
  test(`${item.kind}: visibility filtering remains after the committed write`, async () => {
    await seed(item);
    await driver.executeQuery(`MATCH (n:${item.label}) SET n.ageGateRestricted=true`);
    for (const undo of [false, true]) {
      const target = output(await execute(item, undo));
      if (item.label === "Event") assert.equal(target.id, "target"); else assert.equal(target, null);
      assert.equal(await count(item), undo ? 0 : 1);
    }
  });
  test(`${item.kind}: malformed required database fields fail after each write`, async () => {
    await seed(item);
    await driver.executeQuery(`MATCH (n:${item.label}) REMOVE n.createdAt`);
    for (const undo of [false, true]) {
      const result = await execute(item, undo);
      assert.equal(result.data?.target, null);
      assert.match(result.errors?.[0].message ?? "", /Failed to .*Cannot return null for non-nullable field .*createdAt/);
      assert.equal(await count(item), undo ? 0 : 1);
    }
  });
  test(`${item.kind}: malformed subscriber values retain wrapped errors and committed writes`, async () => {
    await seed(item);
    await driver.executeQuery(`MATCH (n:${item.label}) CREATE (:User)-[:${item.relation}]->(n)`);
    for (const undo of [false, true]) {
      const result = await execute(item, undo);
      assert.match(result.errors?.[0].message ?? "", /Failed to .*User.username/);
      assert.equal(await count(item), undo ? 0 : 1);
    }
  });
  test(`${item.kind}: driver read/write failures preserve each mutation's failure and commit boundary`, async () => {
    await seed(item);
    for (const failure of ["write", "read"] as const) for (const undo of [false, true]) {
      await driver.executeQuery(`MATCH (:User {username:'actor'})-[r:${item.relation}]->() DELETE r`);
      if (undo) await link(item);
      const field = schema.getMutationType()!.getFields()[operation(item, undo)];
      const original = field.resolve;
      field.resolve = getResolvers(faultDriver(failure)).resolvers.Mutation[operation(item, undo)];
      try {
        const result = await execute(item, undo, "target", true, false);
        assert.equal(result.data?.target, null);
        assert.match(result.errors?.[0].message ?? "", new RegExp(`Failed to .*injected ${failure} failure`));
        assert.equal(await count(item), failure === "write" ? (undo ? 1 : 0) : (undo ? 0 : 1));
      } finally { field.resolve = original; }
    }
  });
}
test("GraphQL responses preserve numerical/string/Boolean coercion from database projections", async () => {
  await seed(cases[1]);
  await driver.executeQuery("MATCH(n:DiscussionChannel) SET n.discussionId=4,n.archived=1");
  assert.match((await execute(cases[1])).errors?.[0].message ?? "", /Boolean cannot represent/);
  await driver.executeQuery("MATCH(n:DiscussionChannel) SET n.archived=$value", { value: 1 });
  const discussion = output(await execute(cases[1]));
  assert.equal(discussion.discussionId, "4"); assert.equal(discussion.archived, true);
  await resetDatabase(driver); await seed(cases[4]);
  await driver.executeQuery("MATCH(n:Issue) SET n.issueNumber='42',n.title=$value", { value: 17 });
  const issue = output(await execute(cases[4]));
  assert.equal(issue.issueNumber, 42); assert.equal(issue.title, "17");
});
