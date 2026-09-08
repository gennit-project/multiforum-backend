import test from "node:test";
import assert from "node:assert/strict";
import { issueLocalDevToken } from "../../services/localDevAuth.js";
import { setUserDataOnContext } from "./userDataHelperFunctions.js";
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

// A context whose `user` is already populated, with an ogm/model that throws if
// touched — so any DB access from setUserDataOnContext would fail the test.
const contextWithResolvedUser = (): AuthContextForUserLookup => ({
  ogm: {
    model() {
      throw new Error("ogm.model must not be called when user is memoized");
    },
  } as unknown as AuthContextForUserLookup["ogm"],
  req: { headers: { authorization: "Bearer any-token" } } as never,
  user: resolvedUser,
});

test("returns the already-resolved user when identity is on the context", async () => {
  const result = await setUserDataOnContext({ context: contextWithResolvedUser() });
  assert.deepEqual(result, resolvedUser);
});

test("does not touch the database when identity is already resolved", async () => {
  // contextWithResolvedUser().ogm.model throws if called; reaching here means it
  // was never called. Assert the resolved username to make the check explicit.
  const result = await setUserDataOnContext({ context: contextWithResolvedUser() });
  assert.equal(result.username, "alice");
});

test("does no DB work for an unauthenticated request (no token)", async () => {
  let modelCalls = 0;
  const context = {
    ogm: {
      model() {
        modelCalls += 1;
        return {};
      },
    },
    req: { headers: {} },
  } as unknown as AuthContextForUserLookup;

  const result = await setUserDataOnContext({ context });
  assert.equal(modelCalls, 0);
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

test("resolves a signed local token through the persisted email relationship", async () => {
  await withLocalAuthEnvironment(async () => {
    const token = issueLocalDevToken(
      localAuthEnvironment.MULTIFORUM_BOOTSTRAP_PASSWORD,
      localAuthEnvironment
    );
    assert.ok(token);

    const context = {
      ogm: {
        model(name: string) {
          if (name === "Email") {
            return {
              find: async () => [{ User: { username: "persisted_admin" } }],
            };
          }
          if (name === "User") {
            return {
              find: async () => [
                { ModerationProfile: { displayName: "Local Admin" } },
              ],
            };
          }
          throw new Error(`Unexpected model ${name}`);
        },
      },
      req: { headers: { authorization: `Bearer ${token}` } },
    } as unknown as AuthContextForUserLookup;

    const result = await setUserDataOnContext({ context });
    assert.deepEqual(result, {
      username: "persisted_admin",
      email: "admin@example.test",
      email_verified: true,
      data: { ModerationProfile: { displayName: "Local Admin" } },
    });
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
    const context = {
      ogm: {
        model(name: string) {
          if (name === "Email") {
            return {
              find: async () => [{ User: { username: "oidc_member" } }],
            };
          }
          if (name === "User") {
            return {
              find: async () => [
                { ModerationProfile: { displayName: "OIDC Member" } },
              ],
            };
          }
          throw new Error(`Unexpected model ${name}`);
        },
      },
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
