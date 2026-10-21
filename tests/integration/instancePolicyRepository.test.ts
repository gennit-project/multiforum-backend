import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import { loadAgePolicy, DEFAULT_AGE_POLICY } from "../../services/agePolicy.js";
import { installRequestScopedBookmarks } from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const schema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  initializeOgmFromExistingSchema(ogm, schema, await schema.getSchema());
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const oldAge = (serverName: string) => ogm.model("ServerConfig").find({
  where: { serverName }, selectionSet: `{
    accountAgeGateEnabled minimumAccountAge sensitiveContentAgeGateEnabled minimumSensitiveContentAge
  }`,
});
const oldSetup = (serverName?: string) => ogm.model("ServerConfig").find({
  ...(serverName ? { where: { serverName } } : {}),
  selectionSet: "{ serverName enableDownloads enableEvents }",
}).then(rows => rows.map(({ enableDownloads, enableEvents }) => ({ enableDownloads, enableEvents })));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

for (const properties of [
  { serverName: "named" },
  { serverName: "named", minimumAccountAge: "invalid", minimumSensitiveContentAge: "21" },
  { serverName: "named", accountAgeGateEnabled: false, minimumAccountAge: 0, sensitiveContentAgeGateEnabled: true, minimumSensitiveContentAge: 21, enableDownloads: true, enableEvents: false },
  { serverName: "named", accountAgeGateEnabled: 1, minimumAccountAge: 13, sensitiveContentAgeGateEnabled: 0, minimumSensitiveContentAge: 18, enableDownloads: 0, enableEvents: 1 },
]) {
  test(`matches production OGM selected scalar behavior: ${JSON.stringify(properties)}`, async () => {
    await driver.executeQuery("CREATE (config:ServerConfig) SET config = $properties", { properties });
    const repository = createInstancePolicyRepository(driver);
    assert.deepEqual(await repository.findAgePolicyConfigs("named"), plain(await oldAge("named")));
    assert.deepEqual(await repository.findSetupConfigs("named"), plain(await oldSetup("named")));
    assert.deepEqual(await repository.findSetupConfigs(), plain(await oldSetup()));
  });
}

test("missing and unmatched configs preserve defaults; whitespace is not trimmed by age lookup", async () => {
  const repository = createInstancePolicyRepository(driver);
  assert.deepEqual(await repository.findAgePolicyConfigs("missing"), []);
  assert.deepEqual(await repository.findSetupConfigs(), []);
  assert.deepEqual(await loadAgePolicy(repository, "missing"), DEFAULT_AGE_POLICY);
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'named', accountAgeGateEnabled:true})");
  assert.deepEqual(await repository.findAgePolicyConfigs(" named "), plain(await oldAge(" named ")));
  assert.deepEqual(await repository.findSetupConfigs("other"), plain(await oldSetup("other")));
});

for (const [field, value, operation] of [
  ["minimumAccountAge", "", "age"],
  ["minimumSensitiveContentAge", 2147483648, "age"],
  ["accountAgeGateEnabled", "invalid", "age"],
  ["enableDownloads", "invalid", "setup"],

] as const) {
  test(`preserves selected-field failure for ${field}`, async () => {
    await driver.executeQuery("CREATE (config:ServerConfig {serverName:'named'}) SET config[$field] = $value", { field, value });
    const repository = createInstancePolicyRepository(driver);
    const old = operation === "age" ? () => oldAge("named") : () => oldSetup();
    const current = operation === "age" ? () => repository.findAgePolicyConfigs("named") : () => repository.findSetupConfigs();
    let message = "";
    await assert.rejects(old, error => { message = (error as Error).message; return true; });
    await assert.rejects(current, error => { assert.equal((error as Error).message, message); return true; });
  });
}

test("validates every selected record rather than limiting to the first config", async () => {
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'named', enableEvents:true}), (:ServerConfig {serverName:'other', enableDownloads:'invalid'})");
  await assert.rejects(oldSetup, /Boolean cannot represent/);
  await assert.rejects(() => createInstancePolicyRepository(driver).findSetupConfigs(), /Boolean cannot represent/);
});

test("nullable server names remain accepted by unfiltered setup reads", async () => {
  await driver.executeQuery("CREATE (:ServerConfig {enableEvents:true})");
  assert.deepEqual(await createInstancePolicyRepository(driver).findSetupConfigs(), plain(await oldSetup()));
});
