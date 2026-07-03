import test from "node:test";
import assert from "node:assert/strict";
import { buildSchema, parse, validate } from "graphql";
import depthLimit from "graphql-depth-limit";

// index.ts registers `depthLimit(maxQueryDepth)` as an Apollo validation rule to
// reject pathologically deep queries before they reach the Neo4jGraphQL schema
// (a deep selection becomes one huge Cypher query). These tests pin that the
// rule actually enforces a depth bound, using a self-referential schema so we
// can build queries of arbitrary nesting depth.

const schema = buildSchema(`
  type Node { value: String, child: Node }
  type Query { root: Node }
`);

// Build a query nesting `child` `levels` deep below root.
const nestedQuery = (levels: number): string => {
  let inner = "value";
  for (let i = 0; i < levels; i += 1) inner = `child { ${inner} }`;
  return `{ root { ${inner} } }`;
};

const validationErrors = (query: string, max: number) =>
  validate(schema, parse(query), [depthLimit(max)]);

test("depthLimit allows a query within the configured depth", () => {
  assert.equal(validationErrors(nestedQuery(2), 5).length, 0);
});

test("depthLimit rejects a query deeper than the configured depth", () => {
  assert.ok(validationErrors(nestedQuery(20), 5).length > 0);
});
