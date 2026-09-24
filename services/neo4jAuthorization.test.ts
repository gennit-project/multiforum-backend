import test from "node:test";
import assert from "node:assert/strict";
import { getNeo4jAuthorizationJwt } from "./neo4jAuthorization.js";

test("maps a verified application username to the Neo4j JWT subject", () => {
  assert.deepEqual(
    getNeo4jAuthorizationJwt({
      username: "alice",
      email: "alice@example.com",
      email_verified: true,
      data: null,
    }),
    { sub: "alice" }
  );
});

test("does not authenticate a missing application user", () => {
  assert.equal(getNeo4jAuthorizationJwt(undefined), undefined);
  assert.equal(
    getNeo4jAuthorizationJwt({
      username: null,
      email: null,
      email_verified: false,
      data: null,
    }),
    undefined
  );
});
