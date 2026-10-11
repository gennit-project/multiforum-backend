import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import type { Driver, Session } from "neo4j-driver";
import type { ServerConfigModel } from "../../ogm_types.js";
import { issueLocalDevToken } from "../../services/localDevAuth.js";
import { invalidateAgePolicyCache } from "../../services/agePolicyCache.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

const AUTH_ENV = {
  NODE_ENV: "development",
  MULTIFORUM_AUTH_PROVIDER: "local-dev",
  MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
  MULTIFORUM_BOOTSTRAP_USERNAME: "alice",
  MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
  SUPERADMIN_EMAIL: "admin@example.test",
};

const previousEnvironment = Object.fromEntries(
  Object.keys(AUTH_ENV).map((name) => [name, process.env[name]])
);

let driver: Driver;
let databaseCalls = 0;

before(async () => {
  Object.assign(process.env, AUTH_ENV);
  driver = await startNeo4j();

  const originalSession = driver.session.bind(driver);
  driver.session = ((...args: Parameters<Driver["session"]>): Session => {
    const session = originalSession(...args);
    const originalRun = session.run.bind(session);
    session.run = ((...runArgs: Parameters<Session["run"]>) => {
      databaseCalls += 1;
      return originalRun(...runArgs);
    }) as Session["run"];
    return session;
  }) as Driver["session"];
}, { timeout: 240000 });

after(async () => {
  await stopNeo4j();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(async () => {
  invalidateAgePolicyCache();
  await resetDatabase(driver);
  const session = driver.session();
  try {
    await session.run(
      `CREATE (email:Email {address: $email})
       CREATE (user:User {username: 'alice', dateOfBirth: date('2000-01-01')})
       CREATE (profile:ModerationProfile {displayName: 'Moderator Alice'})
       CREATE (email)-[:HAS_EMAIL]->(user)
       CREATE (user)-[:MODERATION_PROFILE]->(profile)`,
      { email: AUTH_ENV.MULTIFORUM_BOOTSTRAP_EMAIL }
    );
  } finally {
    await session.close();
  }
  databaseCalls = 0;
});

const policyModel = {
  find: async () => [{
    accountAgeGateEnabled: false,
    minimumAccountAge: 13,
    sensitiveContentAgeGateEnabled: true,
    minimumSensitiveContentAge: 18,
  }],
} as unknown as ServerConfigModel;

test("resolves authenticated identity, moderation profile, and age access in one DB call", async () => {
  const token = issueLocalDevToken(
    AUTH_ENV.MULTIFORUM_BOOTSTRAP_PASSWORD,
    AUTH_ENV
  );
  assert.ok(token);

  const context = {
    driver,
    ogm: { model: () => ({}) },
    req: { headers: { authorization: `Bearer ${token}` } },
  } as unknown as GraphQLContext;

  const access = await mayAccessSensitiveContent({
    context,
    driver,
    ServerConfig: policyModel,
    now: new Date("2026-10-10T12:00:00.000Z"),
    serverName: "integration-test",
  });

  assert.equal(access, true);
  assert.equal(databaseCalls, 1);
  assert.deepEqual(context.user, {
    username: "alice",
    email: "admin@example.test",
    email_verified: true,
    data: { ModerationProfile: { displayName: "Moderator Alice" } },
    dateOfBirth: "2000-01-01",
  });
});
