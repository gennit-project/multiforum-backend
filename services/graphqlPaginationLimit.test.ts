import assert from "node:assert/strict";
import test from "node:test";
import { GraphQLError, parse } from "graphql";
import { assertQueryPaginationLimits } from "./graphqlPaginationLimit.js";

const operation = (source: string) => {
  const document = parse(source);
  const definition = document.definitions[0];
  if (definition.kind !== "OperationDefinition") throw new Error("operation expected");
  return { document, operation: definition };
};

test("allows query page sizes at the maximum", () => {
  assert.doesNotThrow(() =>
    assertQueryPaginationLimits({
      ...operation("query { discussions(options: { limit: 100 }) { id } }"),
    })
  );
});

test("rejects oversized inline page sizes", () => {
  assert.throws(
    () =>
      assertQueryPaginationLimits({
        ...operation("query { discussions(options: { limit: 101 }) { id } }"),
      }),
    (error) => error instanceof GraphQLError
  );
});

test("rejects negative inline page sizes", () => {
  assert.throws(
    () =>
      assertQueryPaginationLimits({
        ...operation("query { discussions(options: { limit: -1 }) { id } }"),
      }),
    /non-negative integer/
  );
});

test("rejects oversized nested variable page sizes", () => {
  assert.throws(
    () =>
      assertQueryPaginationLimits({
        ...operation("query List($options: Options) { list(options: $options) }"),
        variables: { options: { offset: 0, limit: 500 } },
      }),
    /variables\.options\.limit/
  );
});

test("does not apply query pagination limits to mutations", () => {
  assert.doesNotThrow(() =>
    assertQueryPaginationLimits({
      ...operation("mutation { startCampaign(limit: 500) }"),
    })
  );
});

test("checks fragments used by the selected query", () => {
  const document = parse(`
    query List { channel { ...TooMuch } }
    fragment TooMuch on Channel { discussions(options: { limit: 101 }) { id } }
  `);
  const definition = document.definitions[0];
  if (definition.kind !== "OperationDefinition") throw new Error("operation expected");
  assert.throws(
    () => assertQueryPaginationLimits({ document, operation: definition }),
    /at most 100/
  );
});

test("ignores unselected operations", () => {
  const document = parse(`
    query Selected { discussions(options: { limit: 25 }) { id } }
    query Unselected { discussions(options: { limit: 500 }) { id } }
  `);
  const definition = document.definitions[0];
  if (definition.kind !== "OperationDefinition") throw new Error("operation expected");
  assert.doesNotThrow(() =>
    assertQueryPaginationLimits({ document, operation: definition })
  );
});
