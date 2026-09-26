import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { buildSchema, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  applySensitiveContentPolicy,
  buildSensitiveContentPolicyMiddleware,
} from "./sensitiveContentPolicyMiddleware.js";
import {
  invalidateAgePolicyCache,
  loadCachedAgePolicy,
} from "../services/agePolicyCache.js";

// The age policy is cached per process; isolate each test's policy.
beforeEach(() => {
  invalidateAgePolicyCache();
});

const resolver = async (
  _parent: unknown,
  _args: Record<string, unknown>,
  context: GraphQLContext
) => context.jwt;

const contextWithAccess = (access: boolean) => ({
  mayAccessSensitiveContent: access,
  jwt: { clientSuppliedClaim: "preserved", mayAccessSensitiveContent: !access },
  driver: {},
  ogm: { model: () => ({}) },
}) as unknown as GraphQLContext;

for (const operation of ["Query", "Mutation", "Subscription"] as const) {
  test(`${operation} middleware injects and overrides the server-computed claim`, async () => {
    const schema = buildSchema(`
      type Query { queryField: Boolean }
      type Mutation { mutationField: Boolean }
      type Subscription { subscriptionField: Boolean }
    `);
    const middleware = buildSensitiveContentPolicyMiddleware(schema);
    const context = contextWithAccess(false);
    assert.equal(typeof middleware[operation], "function");
    const result = await applySensitiveContentPolicy(
      resolver,
      null,
      {},
      context,
      null as unknown as GraphQLResolveInfo
    ) as Record<string, unknown>;

    assert.deepEqual(result, {
      clientSuppliedClaim: "preserved",
      mayAccessSensitiveContent: false,
    });
  });
}

test("only registers middleware for operation types present in the schema", () => {
  const middleware = buildSensitiveContentPolicyMiddleware(
    buildSchema("type Query { health: Boolean }")
  );
  assert.deepEqual(Object.keys(middleware), ["Query"]);
});

test.describe("clears the cached age policy after ServerConfig writes", () => {
  for (const [fieldName, parentType, expectedLoads] of [
    ["updateServerConfigs", "Mutation", 2],
    ["createServerConfigs", "Mutation", 2],
    ["updateDiscussions", "Mutation", 1],
    ["serverConfigs", "Query", 1],
  ] as const) {
    test(`${parentType}.${fieldName} -> ${expectedLoads} policy load(s)`, async () => {
      let loads = 0;
      const ServerConfig = { find: async () => { loads += 1; return []; } } as any;
      await loadCachedAgePolicy({ ServerConfig, serverName: "s" });

      await applySensitiveContentPolicy(
        resolver,
        null,
        {},
        contextWithAccess(true),
        { parentType: { name: parentType }, fieldName } as unknown as GraphQLResolveInfo
      );
      await loadCachedAgePolicy({ ServerConfig, serverName: "s" });

      assert.equal(loads, expectedLoads);
    });
  }
});
