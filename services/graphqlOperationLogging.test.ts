import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "graphql";
import {
  fingerprintGraphQLQuery,
  graphqlOperationLoggingPlugin,
  resolveDiagnosticQueryLogging,
} from "./graphqlOperationLogging.js";

const query = "query CurrentUser { currentUser { username } }";

test("query fingerprints are stable without exposing query text", () => {
  const fingerprint = fingerprintGraphQLQuery(query);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, fingerprintGraphQLQuery(query));
  assert.notEqual(fingerprint, fingerprintGraphQLQuery(`${query} `));
  assert.equal(fingerprint.includes("CurrentUser"), false);
});

test("diagnostic query logging requires an explicit truthy value", () => {
  for (const value of ["true", "1", "yes", "on", " YES "]) {
    assert.equal(resolveDiagnosticQueryLogging(value), true);
  }
  for (const value of [undefined, "", "false", "unexpected"]) {
    assert.equal(resolveDiagnosticQueryLogging(value), false);
  }
});

test("reports safe operation metadata without variables or query text", async () => {
  const observations: unknown[] = [];
  const plugin = graphqlOperationLoggingPlugin({
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({
    request: {
      operationName: "CurrentUser",
      query,
      variables: { accessToken: "secret-token" },
    },
  } as never);
  const operation = parse(query).definitions[0];
  assert.equal(operation.kind, "OperationDefinition");
  await hooks!.didResolveOperation!({ operation } as never);
  await hooks!.willSendResponse!({
    request: { operationName: "CurrentUser" },
    response: {
      body: { kind: "single", singleResult: { data: { currentUser: null } } },
      http: { status: 200 },
    },
  } as never);

  assert.deepEqual(observations, [
    {
      operationName: "CurrentUser",
      operationType: "query",
      queryFingerprint: fingerprintGraphQLQuery(query),
      outcome: "success",
      httpStatus: 200,
    },
  ]);
  assert.equal(JSON.stringify(observations).includes("secret-token"), false);
  assert.equal(JSON.stringify(observations).includes(query), false);
});

test("reports failed operations and gates diagnostic query text", async () => {
  const observations: unknown[] = [];
  const plugin = graphqlOperationLoggingPlugin({
    includeQueryText: true,
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({
    request: { operationName: "CurrentUser", query },
  } as never);
  await hooks!.willSendResponse!({
    request: { operationName: "CurrentUser" },
    response: {
      body: { kind: "single", singleResult: { errors: [{ message: "failed" }] } },
      http: { status: 400 },
    },
  } as never);

  assert.deepEqual(observations, [
    {
      operationName: "CurrentUser",
      operationType: undefined,
      queryFingerprint: fingerprintGraphQLQuery(query),
      outcome: "error",
      httpStatus: 400,
      query,
    },
  ]);
});

test("marks an operation failed when Apollo reports an encountered error", async () => {
  const observations: Array<{ outcome: string }> = [];
  const plugin = graphqlOperationLoggingPlugin({
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({
    request: { operationName: "CurrentUser", query },
  } as never);
  await hooks!.didEncounterErrors!({} as never);
  await hooks!.willSendResponse!({
    request: { operationName: "CurrentUser" },
    response: {
      body: { kind: "single", singleResult: { data: null } },
      http: { status: 500 },
    },
  } as never);
  assert.equal(observations[0]?.outcome, "error");
});

test("does not log introspection operations", async () => {
  const observations: unknown[] = [];
  const plugin = graphqlOperationLoggingPlugin({
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({
    request: { operationName: "IntrospectionQuery", query: "query IntrospectionQuery { __schema { description } }" },
  } as never);
  await hooks!.willSendResponse!({
    request: { operationName: "IntrospectionQuery" },
    response: {
      body: { kind: "single", singleResult: { data: {} } },
      http: { status: 200 },
    },
  } as never);
  assert.deepEqual(observations, []);
});
