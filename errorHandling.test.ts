// Unit tests for the GraphQL error formatter and the Apollo error-handling
// plugin. formatGraphQLError is pure (aside from logging); the plugin's
// didEncounterErrors is invoked directly. No server or database.
import assert from "node:assert/strict";
import test from "node:test";
import { formatGraphQLError, errorHandlingPlugin } from "./errorHandling.js";

// Build an EnhancedError-shaped object (Error + GraphQL fields).
const makeError = (
  message: string,
  extra: { code?: string; locations?: any; path?: any; stack?: string } = {}
): any => {
  const err: any = new Error(message);
  if (extra.code) err.extensions = { code: extra.code };
  if (extra.locations) err.locations = extra.locations;
  if (extra.path) err.path = extra.path;
  if (extra.stack !== undefined) err.stack = extra.stack;
  return err;
};

// Run formatGraphQLError with NODE_ENV forced, restoring it afterward.
const formatWithEnv = (env: string | undefined, error: any, context?: any) => {
  const original = process.env.NODE_ENV;
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
  try {
    return formatGraphQLError(error, context);
  } finally {
    process.env.NODE_ENV = original;
  }
};

test("defaults to UNKNOWN_ERROR and leaves the message unchanged", () => {
  const out = formatGraphQLError(makeError("something broke"));
  assert.equal(out.extensions?.code, "UNKNOWN_ERROR");
  assert.equal(out.message, "something broke");
  assert.ok(out.extensions?.errorId);
  assert.ok(out.extensions?.timestamp);
});

test("enhances the message per error code", () => {
  const cases: Array<[string, RegExp]> = [
    ["GRAPHQL_VALIDATION_FAILED", /^Schema Validation Error:/],
    ["GRAPHQL_PARSE_FAILED", /^Query Parse Error:/],
    ["BAD_USER_INPUT", /^Invalid Input:/],
    ["UNAUTHENTICATED", /^Authentication Required:/],
    ["FORBIDDEN", /^Permission Denied:/],
    ["INTERNAL_SERVER_ERROR", /^Internal Server Error:/],
  ];
  for (const [code, re] of cases) {
    const out = formatGraphQLError(makeError("boom", { code }));
    assert.match(out.message, re, `code ${code}`);
    assert.equal(out.extensions?.code, code);
  }
});

test("attaches the right debug hint by error category", () => {
  const validation = formatGraphQLError(makeError("x", { code: "BAD_USER_INPUT" }));
  assert.match(String(validation.extensions?.debugHint), /schema/i);

  const auth = formatGraphQLError(makeError("x", { code: "UNAUTHENTICATED" }));
  assert.match(String(auth.extensions?.debugHint), /[Aa]uthentication/);

  const perm = formatGraphQLError(makeError("x", { code: "FORBIDDEN" }));
  assert.match(String(perm.extensions?.debugHint), /permission/i);

  const unknown = formatGraphQLError(makeError("x"));
  assert.equal(unknown.extensions?.debugHint, undefined);
});

test("passes through locations and path", () => {
  const locations = [{ line: 2, column: 5 }];
  const path = ["createComment", 0, "text"];
  const out = formatGraphQLError(makeError("x", { code: "BAD_USER_INPUT", locations, path }));
  assert.deepEqual(out.locations, locations);
  assert.deepEqual(out.path, path);
});

test("includes extra debugging fields only in development", () => {
  const error = makeError("raw message", { code: "INTERNAL_SERVER_ERROR", stack: "STACK" });
  const context = { operationName: "DoThing", variables: { a: 1 } };

  const dev = formatWithEnv("development", error, context);
  assert.equal(dev.extensions?.originalMessage, "raw message");
  assert.equal(dev.extensions?.stack, "STACK");
  assert.equal(dev.extensions?.operationName, "DoThing");

  const prod = formatWithEnv("production", error, context);
  assert.equal(prod.extensions?.originalMessage, undefined);
  assert.equal(prod.extensions?.stack, undefined);
  assert.equal(prod.extensions?.operationName, undefined);
});

test("redacts sensitive variables (development output)", () => {
  const error = makeError("x", { code: "BAD_USER_INPUT" });
  const context = {
    variables: { username: "alice", password: "hunter2", authToken: "abc", secretKey: "s" },
  };
  const dev: any = formatWithEnv("development", error, context);
  assert.equal(dev.extensions.variables.username, "alice");
  assert.equal(dev.extensions.variables.password, "[REDACTED]");
  assert.equal(dev.extensions.variables.authToken, "[REDACTED]");
  assert.equal(dev.extensions.variables.secretKey, "[REDACTED]");
});

test("errorHandlingPlugin processes errors without throwing", async () => {
  const handlers: any = await errorHandlingPlugin.requestDidStart();
  assert.equal(typeof handlers.didEncounterErrors, "function");

  await assert.doesNotReject(
    handlers.didEncounterErrors({
      request: { operationName: "Op", variables: { x: 1 }, query: "{ x }" },
      errors: [
        makeError("normal", { code: "BAD_USER_INPUT" }),
        makeError("Cannot connect to database"), // critical path via message
        makeError("boom", { code: "INTERNAL_SERVER_ERROR" }), // critical path via code
      ],
      contextValue: { user: { id: "u1" } },
    })
  );
});
