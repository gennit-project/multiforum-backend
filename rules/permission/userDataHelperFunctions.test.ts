import test from "node:test";
import assert from "node:assert/strict";
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
