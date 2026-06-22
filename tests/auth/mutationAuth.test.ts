// Authorization-wiring tests: execute real mutations through the real schema +
// graphql-shield layer as an UNAUTHENTICATED request, and assert each is
// rejected. A unit test can confirm a permission rule returns false in
// isolation, but only executing through the wired schema proves the rule is
// actually attached to the operation — catching "correct rule, wrong field"
// leaks and accidental removal of the `Mutation: { "*": deny }` default.
//
// Deny paths resolve entirely within graphql-shield, so these need no database.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import {
  buildPermissionedSchema,
  makeRequestContext,
} from "../helpers/buildPermissionedSchema.js";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  ({ schema, driver, ogm } = await buildPermissionedSchema());
}, { timeout: 120000 });

after(async () => {
  await driver.close();
});

const execUnauthenticated = (source: string) =>
  graphql({
    schema,
    source,
    contextValue: makeRequestContext({ isMutation: true, driver, ogm }),
  });

// delete<Type>s mutations take only an optional `where`, so these are valid
// GraphQL with no inputs — any error is therefore an auth error, not a
// validation error. Every one is gated `and(isAuthenticated, ...)`.
const authGatedDeletes = [
  "deleteUsers",
  "deleteDiscussions",
  "deleteEvents",
  "deleteComments",
  "deleteChannels",
];

for (const mutation of authGatedDeletes) {
  test(`${mutation} is rejected for an unauthenticated request`, async () => {
    const result = await execUnauthenticated(
      `mutation { ${mutation} { nodesDeleted } }`
    );

    assert.ok(
      result.errors && result.errors.length > 0,
      `${mutation} should error when unauthenticated`
    );
    assert.equal(
      result.errors[0].message,
      ERROR_MESSAGES.channel.notAuthenticated,
      `${mutation} should fail with the not-authenticated error, got: ${result.errors[0].message}`
    );
    // A denied top-level mutation nulls the entire data payload — the resolver
    // never ran.
    assert.equal(result.data, null);
  });
}
