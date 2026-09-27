import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { GraphQLResolveInfo, GraphQLSchema } from "graphql";
import typeDefinitions from "../typeDefs.js";
import type { GraphQLContext } from "../types/context.js";
import {
  AGE_GATE_UNSAFE_WRITE_ERROR_CODE,
  validateAgeGateWrites,
} from "./ageGateWriteValidatorMiddleware.js";

let schema: GraphQLSchema;

before(async () => {
  schema = await new Neo4jGraphQL({ typeDefs: typeDefinitions }).getSchema();
}, { timeout: 120000 });

afterEach(() => {
  delete process.env.AGE_GATE_WRITE_VALIDATOR;
});

const unsafeMove = {
  where: { id: "reply" },
  update: { ParentComment: { connect: { where: { node: { id: "root" } } } } },
};

const run = (args: Record<string, unknown>) => {
  const calls: unknown[] = [];
  const resolve = async (_parent: unknown, resolvedArgs: Record<string, unknown>) => {
    calls.push(resolvedArgs);
    return "resolved";
  };
  const info = { schema, fieldName: "updateComments" } as unknown as GraphQLResolveInfo;
  const result = validateAgeGateWrites(resolve, null, args, {} as GraphQLContext, info);
  return { calls, result };
};

test("log-only mode still runs an unsafe write", async () => {
  const { result } = run(unsafeMove);
  assert.equal(await result, "resolved");
});

test("enforce mode rejects an unsafe write before it runs", async () => {
  process.env.AGE_GATE_WRITE_VALIDATOR = "enforce";
  const { calls, result } = run(unsafeMove);
  await assert.rejects(result, (error: { extensions?: { code?: string } }) =>
    error.extensions?.code === AGE_GATE_UNSAFE_WRITE_ERROR_CODE
  );
  assert.equal(calls.length, 0);
});

test("enforce mode runs safe writes", async () => {
  process.env.AGE_GATE_WRITE_VALIDATOR = "enforce";
  const { result } = run({ where: { id: "reply" }, update: { text: "edited" } });
  assert.equal(await result, "resolved");
});
