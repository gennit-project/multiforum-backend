import assert from "node:assert/strict";
import test from "node:test";
import { buildSchema, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  applySensitiveContentPolicy,
  buildSensitiveContentPolicyMiddleware,
} from "./sensitiveContentPolicyMiddleware.js";

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
