import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import { loadAgePolicy, DEFAULT_AGE_POLICY } from "../../services/agePolicy.js";
import { installRequestScopedBookmarks } from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

for (const properties of [
  { serverName: "named" },
  { serverName: "named", minimumAccountAge: "invalid", minimumSensitiveContentAge: "21" },
  { serverName: "named", accountAgeGateEnabled: false, minimumAccountAge: 0, sensitiveContentAgeGateEnabled: true, minimumSensitiveContentAge: 21, enableDownloads: true, enableEvents: false },
  { serverName: "named", accountAgeGateEnabled: 1, minimumAccountAge: 13, sensitiveContentAgeGateEnabled: 0, minimumSensitiveContentAge: 18, enableDownloads: 0, enableEvents: 1 },
]) {
  test(`matches production OGM selected scalar behavior: ${JSON.stringify(properties)}`, async (t) => {
    await driver.executeQuery("CREATE (config:ServerConfig) SET config = $properties", { properties });
    const repository = createInstancePolicyRepository(driver);
    t.assert.snapshot(await repository.findAgePolicyConfigs("named"));
    t.assert.snapshot(await repository.findSetupConfigs("named"));
    t.assert.snapshot(await repository.findSetupConfigs());
  });
}

test("missing and unmatched configs preserve defaults; whitespace is not trimmed by age lookup", async (t) => {
  const repository = createInstancePolicyRepository(driver);
  assert.deepEqual(await repository.findAgePolicyConfigs("missing"), []);
  assert.deepEqual(await repository.findSetupConfigs(), []);
  assert.deepEqual(await loadAgePolicy(repository, "missing"), DEFAULT_AGE_POLICY);
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'named', accountAgeGateEnabled:true})");
  t.assert.snapshot(await repository.findAgePolicyConfigs(" named "));
  t.assert.snapshot(await repository.findSetupConfigs("other"));
});

for (const [field, value, operation, message] of [
  ["minimumAccountAge", "", "age", /Int cannot represent/],
  ["minimumSensitiveContentAge", 2147483648, "age", /Int cannot represent/],
  ["accountAgeGateEnabled", "invalid", "age", /Boolean cannot represent a non boolean value/],
  ["enableDownloads", "invalid", "setup", /Boolean cannot represent a non boolean value/],

] as const) {
  test(`preserves selected-field failure for ${field}`, async () => {
    await driver.executeQuery("CREATE (config:ServerConfig {serverName:'named'}) SET config[$field] = $value", { field, value });
    const repository = createInstancePolicyRepository(driver);
    const current = operation === "age" ? () => repository.findAgePolicyConfigs("named") : () => repository.findSetupConfigs();
    await assert.rejects(current, message);
  });
}

test("validates every selected record rather than limiting to the first config", async () => {
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'named', enableEvents:true}), (:ServerConfig {serverName:'other', enableDownloads:'invalid'})");
  await assert.rejects(() => createInstancePolicyRepository(driver).findSetupConfigs(), /Boolean cannot represent/);
});

test("nullable server names remain accepted by unfiltered setup reads", async (t) => {
  await driver.executeQuery("CREATE (:ServerConfig {enableEvents:true})");
  t.assert.snapshot(await createInstancePolicyRepository(driver).findSetupConfigs());
});
