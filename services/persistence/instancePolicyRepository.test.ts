import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import { makeResult } from "../../tests/fixtures/neo4j.js";
import { createInstancePolicyRepository, FIND_AGE_POLICY_CONFIGS, FIND_SETUP_CONFIGS } from "./instancePolicyRepository.js";
import { loadAgePolicy, DEFAULT_AGE_POLICY } from "../agePolicy.js";

const setup = (failure?: Error) => {
  const configurations: unknown[] = [];
  const calls: unknown[] = [];
  const bookmarkManager = neo4j.bookmarkManager();
  let closed = 0;
  let transactions = 0;
  const driver = {
    executeQueryBookmarkManager: bookmarkManager,
    session(config: unknown) {
      configurations.push(config);
      return {
        async executeRead(work: (tx: unknown) => Promise<unknown>) {
          transactions++;
          return work({ async run(query: string, parameters: unknown) {
            calls.push({ query, parameters });
            if (failure) throw failure;
            return makeResult([]);
          } });
        },
        async close() { closed++; },
      };
    },
  } as unknown as Driver;
  return { driver, configurations, calls, bookmarkManager, counts: () => ({closed, transactions}) };
};

test("both reads retain configured database, managed READ routing and shared bookmarks", async () => {
  const state = setup();
  const repository = createInstancePolicyRepository(state.driver, "policies");
  await repository.findAgePolicyConfigs("name' quote");
  await repository.findSetupConfigs();
  assert.deepEqual(state.configurations, Array(2).fill({ database: "policies", defaultAccessMode: neo4j.session.READ, bookmarkManager: state.bookmarkManager }));
  assert.deepEqual(state.calls, [
    {query: FIND_AGE_POLICY_CONFIGS, parameters: {serverName: "name' quote"}},
    {query: FIND_SETUP_CONFIGS, parameters: {serverName: null}},
  ]);
  assert.deepEqual(state.counts(), {closed: 2, transactions: 2});
});

test("missing configured name preserves default without opening a session", async () => {
  const state = setup();
  assert.deepEqual(await loadAgePolicy(createInstancePolicyRepository(state.driver), ""), DEFAULT_AGE_POLICY);
  assert.equal(state.calls.length, 0);
});

test("database failure propagates and always closes each session", async () => {
  const state = setup(new Error("db unavailable"));
  const repository = createInstancePolicyRepository(state.driver);
  await assert.rejects(repository.findAgePolicyConfigs("s"), /db unavailable/);
  await assert.rejects(repository.findSetupConfigs(), /db unavailable/);
  assert.deepEqual(state.counts(), {closed: 2, transactions: 2});
});

test("native policy query selections match their source contract keys", () => {
  // These queries contain one literal property projection. Check the actual
  // document rather than a second unused selection string.
  const selected = (query: string) => {
    const projection = /RETURN config\s*\{([^}]+)\}\s+AS config/.exec(query);
    assert.ok(projection);
    return [...projection[1].matchAll(/\.([A-Za-z][A-Za-z0-9_]*)/g)]
      .map(match => match[1]).sort();
  };
  const age = {
    accountAgeGateEnabled: true,
    minimumAccountAge: true,
    sensitiveContentAgeGateEnabled: true,
    minimumSensitiveContentAge: true,
  } satisfies Record<keyof import("../../customResolvers/contracts/instancePolicySource.js").NativeAgePolicy, true>;
  const setup = {
    serverName: true,
    enableDownloads: true,
    enableEvents: true,
  } satisfies Record<keyof import("../../customResolvers/contracts/instancePolicySource.js").NativeSetupPolicy, true>;
  assert.deepEqual(selected(FIND_AGE_POLICY_CONFIGS), Object.keys(age).sort());
  assert.deepEqual(selected(FIND_SETUP_CONFIGS), Object.keys(setup).sort());
});
