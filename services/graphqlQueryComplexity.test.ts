import assert from "node:assert/strict";
import test from "node:test";
import { buildSchema, GraphQLError, parse } from "graphql";
import {
  calculateQueryComplexity,
  DEFAULT_MAX_QUERY_COMPLEXITY,
  queryComplexityPlugin,
  resolveMaxQueryComplexity,
} from "./graphqlQueryComplexity.js";

const schema = buildSchema(`
  input ListOptions { limit: Int }
  type Item { id: ID!, children(limit: Int): [Item!]! }
  type Query {
    items(limit: Int, options: ListOptions): [Item!]!
    item: Item
  }
`);

test("weights list selections by their requested page size", () => {
  const small = calculateQueryComplexity({
    document: parse("{ items(limit: 2) { id } }"),
    schema,
  });
  const large = calculateQueryComplexity({
    document: parse("{ items(limit: 20) { id } }"),
    schema,
  });

  assert.equal(small, 3);
  assert.equal(large, 21);
});

test("uses real request variables when calculating complexity", () => {
  const document = parse(
    "query Items($limit: Int!) { items(limit: $limit) { id } }"
  );

  assert.equal(
    calculateQueryComplexity({ document, schema, variables: { limit: 12 } }),
    13
  );
});

test("multiplies nested list costs", () => {
  const complexity = calculateQueryComplexity({
    document: parse(
      "{ items(limit: 10) { id children(limit: 10) { id } } }"
    ),
    schema,
  });

  assert.equal(complexity, 121);
});

test("uses the shared default and maximum page sizes", () => {
  assert.equal(
    calculateQueryComplexity({ document: parse("{ items { id } }"), schema }),
    26
  );
  assert.equal(
    calculateQueryComplexity({
      document: parse("{ items(limit: 1000) { id } }"),
      schema,
    }),
    101
  );
  assert.equal(
    calculateQueryComplexity({
      document: parse("{ items(options: { limit: 7 }) { id } }"),
      schema,
    }),
    8
  );
});

test("uses the simple estimator for non-list fields", () => {
  assert.equal(
    calculateQueryComplexity({ document: parse("{ item { id } }"), schema }),
    2
  );
});

test("rejects an operation before execution when it exceeds the ceiling", async () => {
  const plugin = queryComplexityPlugin({ maximumComplexity: 10 });
  const hooks = await plugin.requestDidStart!({} as never);

  await assert.rejects(
    () =>
      hooks!.didResolveOperation!({
        document: parse("{ items(limit: 20) { id } }"),
        request: {},
        schema,
      } as never),
    (error) =>
      error instanceof GraphQLError &&
      error.extensions.code === "GRAPHQL_VALIDATION_FAILED"
  );
});

test("reads a positive integer ceiling and falls back for invalid values", () => {
  assert.equal(resolveMaxQueryComplexity("1234"), 1234);
  assert.equal(resolveMaxQueryComplexity("0"), DEFAULT_MAX_QUERY_COMPLEXITY);
  assert.equal(resolveMaxQueryComplexity("invalid"), DEFAULT_MAX_QUERY_COMPLEXITY);
});
