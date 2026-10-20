import test from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import jwt from "jsonwebtoken";
import { issueLocalDevToken } from "../../services/localDevAuth.js";
import {
  getPersistedRequestUser,
  setUserDataOnContext,
} from "./userDataHelperFunctions.js";
import type { AuthContextForUserLookup } from "./userDataHelperFunctions.js";

// Identity is stable within a request. setUserDataOnContext is invoked once per
// graphql-shield rule and again directly by many mutation resolvers; the guard
// added for performance must return the already-resolved user WITHOUT issuing
// any further DB lookups. These tests lock that in so a refactor can't silently
// reintroduce the per-rule identity re-query.

const resolvedUser = {
  username: "alice",
  email: "alice@example.com",
  email_verified: true,
  data: { ModerationProfile: { displayName: "Mod Alice" } },
};

const createIdentityDriver = (identity: {
  username: string;
  dateOfBirth?: unknown;
  modProfileName?: string | null;
}) => {
  let sessionCalls = 0;
  let runCalls = 0;
  let closeCalls = 0;
  let query = "";
  const driver = {
    session() {
      sessionCalls += 1;
      return {
        async run(statement: string) {
          runCalls += 1;
          query = statement;
          return {
            records: [{
              get(key: string) {
                return identity[key as keyof typeof identity] ?? null;
              },
            }],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  return {
    driver,
    calls: () => ({ sessionCalls, runCalls, closeCalls }),
    query: () => query,
  };
};

test("skips persisted identity lookup without an email or username", async () => {
  const driver = {
    session() {
      throw new Error("no session should be opened without an identity");
    },
  } as unknown as Driver;

  const result = await getPersistedRequestUser({
    driver,
    email: null,
  });

  assert.equal(result, null);
});

test("uses an injected identity repository without opening a driver session", async () => {
  const driver = {
    session() {
      throw new Error("the injected repository should handle the lookup");
    },
  } as unknown as Driver;
  let requestedEmail = "";

  const result = await getPersistedRequestUser({
    driver,
    email: "alice@example.test",
    requestIdentityRepository: {
      findByUsername: async () => null,
      findByEmail: async (email) => {
        requestedEmail = email;
        return {
          username: "alice",
          dateOfBirth: null,
          modProfileName: null,
        };
      },
      userExists: async () => true,
    },
  });

  assert.equal(requestedEmail, "alice@example.test");
  assert.equal(result?.username, "alice");
});

test("returns null and closes the session when no persisted user exists", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          return { records: [] };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const result = await getPersistedRequestUser({
    driver,
    email: "missing@example.test",
  });

  assert.equal(result, null);
  assert.equal(closeCalls, 1);
});

test("normalizes Neo4j date values returned by the identity query", async () => {
  const identity = createIdentityDriver({
    username: "alice",
    dateOfBirth: { toString: () => "1991-04-05" },
  });

  const result = await getPersistedRequestUser({
    driver: identity.driver,
    email: null,
    username: "alice",
  });

  assert.deepEqual(result, {
    username: "alice",
    dateOfBirth: "1991-04-05",
    modProfileName: null,
  });
  assert.equal(identity.calls().closeCalls, 1);
});

test("returns null and closes the session when the identity query fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          throw new Error("database unavailable");
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const result = await getPersistedRequestUser({
    driver,
    email: "alice@example.test",
  });

  assert.equal(result, null);
  assert.equal(closeCalls, 1);
});

// A context whose `user` is already populated and whose driver throws if
// touched, so any DB access from setUserDataOnContext would fail the test.
const contextWithResolvedUser = (): AuthContextForUserLookup => ({
  driver: {
    session() {
      throw new Error("driver.session must not be called when user is memoized");
    },
  } as unknown as Driver,
  req: { headers: { authorization: "Bearer any-token" } } as never,
  user: resolvedUser,
});

test("returns the already-resolved user when identity is on the context", async () => {
  const result = await setUserDataOnContext({ context: contextWithResolvedUser() });
  assert.deepEqual(result, resolvedUser);
});

test("does not touch the database when identity is already resolved", async () => {
  const result = await setUserDataOnContext({ context: contextWithResolvedUser() });
  assert.equal(result.username, "alice");
});

test("does no DB work for an unauthenticated request (no token)", async () => {
  let sessionCalls = 0;
  const context = {
    driver: {
      session() {
        sessionCalls += 1;
        throw new Error("no session expected");
      },
    },
    req: { headers: {} },
  } as unknown as AuthContextForUserLookup;

  const result = await setUserDataOnContext({ context });
  assert.equal(sessionCalls, 0);
  assert.equal(result.username, null);
});

const localAuthEnvironment = {
  NODE_ENV: "development",
  MULTIFORUM_AUTH_PROVIDER: "local-dev",
  MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
  MULTIFORUM_BOOTSTRAP_USERNAME: "bootstrap_admin",
  MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
  SUPERADMIN_EMAIL: "admin@example.test",
};

const withLocalAuthEnvironment = async (callback: () => Promise<void>) => {
  const previous = Object.fromEntries(
    Object.keys(localAuthEnvironment).map((name) => [name, process.env[name]])
  );
  Object.assign(process.env, localAuthEnvironment);
  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
};

const withOidcEnvironment = async (callback: () => Promise<void>) => {
  const previousProvider = process.env.MULTIFORUM_AUTH_PROVIDER;
  process.env.MULTIFORUM_AUTH_PROVIDER = "oidc";
  try {
    await callback();
  } finally {
    if (previousProvider === undefined) {
      delete process.env.MULTIFORUM_AUTH_PROVIDER;
    } else {
      process.env.MULTIFORUM_AUTH_PROVIDER = previousProvider;
    }
  }
};

const withMockAuthEnvironment = async (callback: () => Promise<void>) => {
  const previous = process.env.E2E_MOCK_AUTH;
  process.env.E2E_MOCK_AUTH = "true";
  try {
    await callback();
  } finally {
    if (previous === undefined) delete process.env.E2E_MOCK_AUTH;
    else process.env.E2E_MOCK_AUTH = previous;
  }
};

test("uses the username lookup path for mock-auth identities", async () => {
  await withMockAuthEnvironment(async () => {
    const identity = createIdentityDriver({
      username: "alice",
      dateOfBirth: "1991-04-05",
      modProfileName: "Mod Alice",
    });
    const token = jwt.sign(
      { username: "alice", email: "alice@example.test" },
      "test-key"
    );
    const context = {
      driver: identity.driver,
      ogm: { model: () => ({}) },
      req: { headers: { authorization: `Bearer ${token}` } },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({ context });

    assert.equal(result.username, "alice");
    assert.equal(result.dateOfBirth, "1991-04-05");
    assert.match(identity.query(), /User \{username: \$username\}/);
    assert.doesNotMatch(identity.query(), /HAS_EMAIL/);
    assert.deepEqual(identity.calls(), {
      sessionCalls: 1,
      runCalls: 1,
      closeCalls: 1,
    });
  });
});

test("resolves a signed local token through the persisted email relationship", async () => {
  await withLocalAuthEnvironment(async () => {
    const token = issueLocalDevToken(
      localAuthEnvironment.MULTIFORUM_BOOTSTRAP_PASSWORD,
      localAuthEnvironment
    );
    assert.ok(token);

    const identity = createIdentityDriver({
      username: "persisted_admin",
      dateOfBirth: "1990-02-03",
      modProfileName: "Local Admin",
    });
    const context = {
      driver: identity.driver,
      ogm: { model: () => ({}) },
      req: { headers: { authorization: `Bearer ${token}` } },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({ context });
    assert.deepEqual(result, {
      username: "persisted_admin",
      email: "admin@example.test",
      email_verified: true,
      data: { ModerationProfile: { displayName: "Local Admin" } },
      dateOfBirth: "1990-02-03",
    });
    assert.deepEqual(identity.calls(), {
      sessionCalls: 1,
      runCalls: 1,
      closeCalls: 1,
    });
    assert.match(identity.query(), /HAS_EMAIL/);
  });
});

test("rejects an invalid local token on mutations", async () => {
  await withLocalAuthEnvironment(async () => {
    const context = {
      ogm: { model: () => ({}) },
      req: {
        headers: { authorization: "Bearer invalid-token" },
        isMutation: true,
      },
    } as unknown as AuthContextForUserLookup;

    await assert.rejects(
      setUserDataOnContext({ context }),
      /authentication token is invalid/i
    );
  });
});

test("marks an invalid local token on query context without throwing", async () => {
  await withLocalAuthEnvironment(async () => {
    const context = {
      ogm: { model: () => ({}) },
      req: {
        headers: { authorization: "Bearer invalid-token" },
        isMutation: false,
      },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({ context });
    assert.equal(result.username, null);
    assert.match(
      context.jwtError?.message ?? "",
      /authentication token is invalid/i
    );
  });
});

test("resolves a verified OIDC identity through the persisted email", async () => {
  await withOidcEnvironment(async () => {
    const identity = createIdentityDriver({
      username: "oidc_member",
      dateOfBirth: null,
      modProfileName: "OIDC Member",
    });
    const context = {
      driver: identity.driver,
      ogm: { model: () => ({}) },
      req: { headers: { authorization: "Bearer oidc-token" } },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({
      context,
      oidcTokenVerifier: async () => ({
        email: "member@example.test",
        subject: "identity-user-1",
      }),
    });
    assert.deepEqual(result, {
      username: "oidc_member",
      email: "member@example.test",
      email_verified: true,
      data: { ModerationProfile: { displayName: "OIDC Member" } },
      dateOfBirth: null,
    });
    assert.deepEqual(identity.calls(), {
      sessionCalls: 1,
      runCalls: 1,
      closeCalls: 1,
    });
  });
});

test("rejects invalid OIDC tokens on mutations", async () => {
  await withOidcEnvironment(async () => {
    const context = {
      ogm: { model: () => ({}) },
      req: {
        headers: { authorization: "Bearer invalid-token" },
        isMutation: true,
      },
    } as unknown as AuthContextForUserLookup;

    await assert.rejects(
      setUserDataOnContext({
        context,
        oidcTokenVerifier: async () => {
          throw new Error("invalid OIDC token");
        },
      }),
      /authentication token is invalid/i
    );
  });
});

test("reports expired OIDC tokens as expired sessions", async () => {
  await withOidcEnvironment(async () => {
    const context = {
      ogm: { model: () => ({}) },
      req: {
        headers: { authorization: "Bearer expired-token" },
        isMutation: true,
      },
    } as unknown as AuthContextForUserLookup;
    const expiredError = new Error("jwt expired");
    expiredError.name = "TokenExpiredError";

    await assert.rejects(
      setUserDataOnContext({
        context,
        oidcTokenVerifier: async () => {
          throw expiredError;
        },
      }),
      /session has expired/i
    );
  });
});

test("marks invalid OIDC tokens on query context", async () => {
  await withOidcEnvironment(async () => {
    const context = {
      ogm: { model: () => ({}) },
      req: {
        headers: { authorization: "Bearer invalid-token" },
        isMutation: false,
      },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({
      context,
      oidcTokenVerifier: async () => {
        throw new Error("invalid OIDC token");
      },
    });
    assert.equal(result.username, null);
    assert.match(
      context.jwtError?.message ?? "",
      /authentication token is invalid/i
    );
  });
});
