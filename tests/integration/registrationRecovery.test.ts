import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { GraphQLObjectType, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import {
  createAccountRegistrationRepository,
  LOCK_REGISTRATION_EMAIL,
} from "../../services/persistence/accountRegistrationRepository.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createUsersWithEmails } from "../../customResolvers/mutations/createEmailAndUser.js";
import createResolver from "../../customResolvers/mutations/createEmailAndUser.js";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let repository: ReturnType<typeof createAccountRegistrationRepository>;
before(
  async () => {
    driver = await startNeo4j();
    // Production creates these identity constraints at startup. MERGE and the
    // username write must have the same uniqueness guarantees in these tests.
    for (const [label, property] of [
      ["Email", "address"],
      ["User", "username"],
      ["ModerationProfile", "displayName"],
    ]) {
      await driver.executeQuery(
        `CREATE CONSTRAINT IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS UNIQUE`,
      );
    }
    const app = getCustomResolvers(driver);
    schema = await new Neo4jGraphQL({
      typeDefs,
      driver,
      resolvers: app.resolvers,
      features: { filters: { String: { MATCHES: true } } },
    }).getSchema();
    registerGeneratedSchema(driver, schema);
    repository = createAccountRegistrationRepository(driver);
    // Validate the write plan against this disposable database before execution.
    await driver.executeQuery(`EXPLAIN ${LOCK_REGISTRATION_EMAIL}`, {
      emailAddress: "plan@example.test",
    });
  },
  { timeout: 240_000 },
);
beforeEach(async () => {
  await resetDatabase(driver);
});
after(async () => {
  await stopNeo4j();
});
const email = "new@example.test";
const register = (
  username = "chosen_name",
  address = email,
  birthday = "2000-01-01",
) => createUsersWithEmails(repository, address, username, birthday);
const counts = async () => {
  const results =
    await driver.executeQuery(`MATCH (n) WHERE n:Email OR n:User OR n:ModerationProfile
    RETURN count(CASE WHEN n:Email THEN 1 END) AS emails,
           count(CASE WHEN n:User THEN 1 END) AS users,
           count(CASE WHEN n:ModerationProfile THEN 1 END) AS profiles`);
  const record = results.records[0];
  return {
    emails: record.get("emails").toNumber(),
    users: record.get("users").toNumber(),
    profiles: record.get("profiles").toNumber(),
  };
};
const accountGraph = async (address = email) => {
  const result = await driver.executeQuery(
    `MATCH (e:Email {address: $address})
    OPTIONAL MATCH (e)-[:HAS_EMAIL]->(u:User)
    OPTIONAL MATCH (u)-[:MODERATION_PROFILE]->(m:ModerationProfile)
    RETURN elementId(e) AS emailId, u.username AS username, toString(u.dateOfBirth) AS birthday,
           m.displayName AS moderator`,
    { address },
  );
  return result.records.map((record) => record.toObject());
};

test("attaches a username to the existing orphan email without replacing the email record", async () => {
  await driver.executeQuery("CREATE (:Email {address: $email})", { email });
  const original = await accountGraph();
  const created = await register();
  const graph = await accountGraph();
  assert.equal(graph[0].emailId, original[0].emailId);
  assert.equal(created.username, "chosen_name");
  assert.equal(created.Email?.address, email);
  assert.equal(graph[0].birthday, "2000-01-01");
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
});

test("creates the missing email and profile together", async () => {
  const created = await register();
  assert.equal(created.username, "chosen_name");
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
});

test("retry after a successful commit returns the same account with no extra nodes or relationships", async () => {
  const first = await register();
  const graph = await accountGraph();
  const retry = await register();
  assert.deepEqual(retry, first);
  assert.deepEqual(await accountGraph(), graph);
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
});

test("restore keeps the existing username and birthday even when signup inputs change or are invalid", async () => {
  const first = await register();
  const graph = await accountGraph();
  const restored = await register("", email, "invalid birthday");
  assert.deepEqual(restored, first);
  assert.deepEqual(await accountGraph(), graph);
});

test("restores the verified email's owner instead of attaching a different existing username", async () => {
  const owner = await register("original_name");
  await register("other_name", "other@example.test");
  const restored = await register("other_name");
  assert.deepEqual(restored, owner);
  assert.deepEqual(await counts(), { emails: 2, users: 2, profiles: 2 });
});

for (const orphanExists of [true, false]) {
  test(`concurrent retries return one account (existing orphan: ${orphanExists})`, async () => {
    if (orphanExists)
      await driver.executeQuery("CREATE (:Email {address: $email})", { email });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => register(`chosen_${index}`)),
    );
    assert.equal(new Set(results.map((result) => result.username)).size, 1);
    assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
    const links = await driver.executeQuery(
      "MATCH (:Email {address: $email})-[r:HAS_EMAIL]->(:User) RETURN count(r) AS links",
      { email },
    );
    assert.equal(links.records[0].get("links").toNumber(), 1);
  });
}

test("a taken username does not leave a newly created email behind", async () => {
  await register("chosen_name", "owner@example.test");
  await assert.rejects(register(), /Username already taken/);
  assert.deepEqual(await accountGraph(), []);
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
});

test("validation failure preserves the orphan email and permits a corrected retry", async () => {
  await driver.executeQuery("CREATE (:Email {address: $email})", { email });
  await assert.rejects(
    register("invalid name"),
    /letters, numbers, and underscores/,
  );
  assert.deepEqual(await counts(), { emails: 1, users: 0, profiles: 0 });
  assert.equal((await register()).username, "chosen_name");
});

test("creation projection errors roll back the whole account and allow a retry", async () => {
  const userType = schema.getType("User");
  assert.ok(userType instanceof GraphQLObjectType);
  const field = userType.getFields().variantUrls;
  const original = field.resolve;
  field.resolve = () => {
    throw new Error("injected response failure");
  };
  try {
    await assert.rejects(register(), /injected response failure/);
    assert.deepEqual(await counts(), { emails: 0, users: 0, profiles: 0 });
  } finally {
    field.resolve = original;
  }
  assert.equal((await register()).username, "chosen_name");
});

test("unverified and mismatched identities cannot claim an orphan email", async () => {
  await driver.executeQuery("CREATE (:Email {address: $email})", { email });
  const resolver = createResolver({
    accountRegistrationRepository: repository,
    agePolicyRepository: { findAgePolicyConfigs: async () => [] },
  });
  for (const identity of [
    { email, email_verified: false },
    { email: "different@example.test", email_verified: true },
  ]) {
    await assert.rejects(
      resolver(
        null,
        { emailAddress: email, username: "chosen_name" },
        { user: { ...identity, username: "verified_identity" } } as never,
        {} as never,
      ),
      /verified login/,
    );
  }
  assert.deepEqual(await counts(), { emails: 1, users: 0, profiles: 0 });
});

test("ambiguous ownership fails without creating or relinking accounts", async () => {
  await driver.executeQuery(
    `CREATE (e:Email {address: $email})
    CREATE (e)-[:HAS_EMAIL]->(:User {username: 'first'})
    CREATE (e)-[:HAS_EMAIL]->(:User {username: 'second'})`,
    { email },
  );
  await assert.rejects(register(), /linked to multiple accounts/);
  assert.deepEqual(await counts(), { emails: 1, users: 2, profiles: 0 });
});

test("different emails competing for one username cannot leave an orphan email", async () => {
  const results = await Promise.allSettled([
    register("shared_name", "first@example.test"),
    register("shared_name", "second@example.test"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 1 });
});

test("an invalid linked account is not replaced with a second owner", async () => {
  await driver.executeQuery(
    "CREATE (:Email {address: $email})-[:HAS_EMAIL]->(:User {username: ''})",
    { email },
  );
  await assert.rejects(register(), /Existing account has no username/);
  assert.deepEqual(await counts(), { emails: 1, users: 1, profiles: 0 });
});

test("failure to read the created account rolls back the write so a retry can succeed", async () => {
  const field = schema.getQueryType()!.getFields().users;
  const original = field.resolve;
  field.resolve = (parent, args, context, info) =>
    info.operation.name?.value === "RegisteredAccount"
      ? []
      : original!(parent, args, context, info);
  try {
    await assert.rejects(register(), /Error creating user and linking email/);
    assert.deepEqual(await counts(), { emails: 0, users: 0, profiles: 0 });
  } finally {
    field.resolve = original;
  }
  assert.equal((await register()).username, "chosen_name");
});
