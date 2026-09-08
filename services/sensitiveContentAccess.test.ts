import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { ServerConfigModel } from "../ogm_types.js";
import type { GraphQLContext } from "../types/context.js";
import { mayAccessSensitiveContent } from "./sensitiveContentAccess.js";

const policyModel = (enabled: boolean, minimumAge = 18) =>
  ({
    find: async () => [{
      accountAgeGateEnabled: false,
      minimumAccountAge: 13,
      sensitiveContentAgeGateEnabled: enabled,
      minimumSensitiveContentAge: minimumAge,
    }],
  }) as unknown as ServerConfigModel;

const createDriver = (birthday: string | null) => {
  let sessionCount = 0;
  let closeCount = 0;
  const driver = {
    session: () => {
      sessionCount += 1;
      return {
        run: async () => ({
          records: birthday === undefined ? [] : [{
            get: (key: string) => key === "birthday" ? birthday : null,
          }],
        }),
        close: async () => {
          closeCount += 1;
        },
      };
    },
  } as unknown as Driver;

  return { driver, counts: () => ({ sessionCount, closeCount }) };
};

const contextFor = (username: string | null): GraphQLContext => ({
  user: username
    ? { username, email: null, email_verified: true, data: null }
    : undefined,
} as GraphQLContext);

const now = new Date("2026-09-08T12:00:00.000Z");

test("allows all callers without reading birthdays when the gate is disabled", async () => {
  const { driver, counts } = createDriver(null);
  const context = contextFor(null);

  assert.equal(await mayAccessSensitiveContent({
    context,
    driver,
    ServerConfig: policyModel(false),
    now,
    serverName: "test",
  }), true);
  assert.deepEqual(counts(), { sessionCount: 0, closeCount: 0 });
});

test("denies an anonymous caller when the gate is enabled", async () => {
  const { driver, counts } = createDriver(null);

  assert.equal(await mayAccessSensitiveContent({
    context: contextFor(null),
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  }), false);
  assert.deepEqual(counts(), { sessionCount: 0, closeCount: 0 });
});

test("fails closed without a GraphQL context when the gate is enabled", async () => {
  const { driver, counts } = createDriver(null);

  assert.equal(await mayAccessSensitiveContent({
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  }), false);
  assert.deepEqual(counts(), { sessionCount: 0, closeCount: 0 });
});

test("denies an authenticated caller whose birthday is missing", async () => {
  const { driver, counts } = createDriver(null);

  assert.equal(await mayAccessSensitiveContent({
    context: contextFor("alice"),
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  }), false);
  assert.deepEqual(counts(), { sessionCount: 1, closeCount: 1 });
});

test("denies an authenticated caller below the sensitive-content age", async () => {
  const { driver } = createDriver("2009-09-09");

  assert.equal(await mayAccessSensitiveContent({
    context: contextFor("alice"),
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  }), false);
});

test("allows an authenticated caller who meets the sensitive-content age", async () => {
  const { driver } = createDriver("2008-09-08");

  assert.equal(await mayAccessSensitiveContent({
    context: contextFor("alice"),
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  }), true);
});

test("caches the decision on the request context", async () => {
  const { driver, counts } = createDriver("2000-01-01");
  const context = contextFor("alice");
  const input = {
    context,
    driver,
    ServerConfig: policyModel(true),
    now,
    serverName: "test",
  };

  assert.equal(await mayAccessSensitiveContent(input), true);
  assert.equal(await mayAccessSensitiveContent(input), true);
  assert.deepEqual(counts(), { sessionCount: 1, closeCount: 1 });
});
