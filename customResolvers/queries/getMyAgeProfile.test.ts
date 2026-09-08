import test from "node:test";
import assert from "node:assert/strict";
import getMyAgeProfile from "./getMyAgeProfile.js";

const policyModel = {
  find: async () => [{ sensitiveContentAgeGateEnabled: true, minimumSensitiveContentAge: 18 }],
} as any;

test("returns only the authenticated caller's birthday and eligibility", async () => {
  let params: Record<string, unknown> | undefined;
  let closed = false;
  const driver = {
    session: () => ({
      run: async (_query: string, queryParams: Record<string, unknown>) => {
        params = queryParams;
        return { records: [{ get: () => "2000-01-01" }] };
      },
      close: async () => { closed = true; },
    }),
  } as any;
  const resolver = getMyAgeProfile({ driver, ServerConfig: policyModel });
  const context = {
    user: { username: "owner", email: "owner@example.com", email_verified: true, data: null },
  } as any;

  const result = await resolver(undefined, undefined, context);
  assert.ok(result);
  assert.deepEqual(params, { username: "owner" });
  assert.equal(result.birthday, "2000-01-01");
  assert.equal(result.mayAccessSensitiveContent, true);
  assert.equal(closed, true);
});

test("returns null without an authenticated account", async () => {
  const resolver = getMyAgeProfile({
    driver: { session: () => { throw new Error("should not query"); } } as any,
    ServerConfig: policyModel,
  });
  assert.equal(await resolver(undefined, undefined, { ogm: {} } as any), null);
});
