import assert from "node:assert/strict";
import test from "node:test";

test("graphql-shield loads on the supported Node runtime", async () => {
  const graphqlShield = await import("graphql-shield");

  assert.equal(typeof graphqlShield.shield, "function");
  assert.equal(typeof graphqlShield.rule, "function");
});
