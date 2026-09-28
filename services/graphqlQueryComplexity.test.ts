import assert from "node:assert/strict";
import test from "node:test";
import { ApolloServer, HeaderMap } from "@apollo/server";
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

test("uses a calibrated estimate for lists without a requested size", () => {
  assert.equal(
    calculateQueryComplexity({ document: parse("{ items { id } }"), schema }),
    6
  );
});

test("caps explicitly requested list sizes at the hard page maximum", () => {
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
  const observations: Array<{
    operationName: string;
    actualComplexity: number;
    maximumComplexity: number;
    rejected: boolean;
  }> = [];
  const plugin = queryComplexityPlugin({
    maximumComplexity: 10,
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({} as never);

  await assert.rejects(
    () =>
      hooks!.didResolveOperation!({
        document: parse("query TooWide { items(limit: 20) { id } }"),
        request: { operationName: "TooWide" },
        schema,
      } as never),
    (error) =>
      error instanceof GraphQLError &&
      error.extensions.code === "QUERY_TOO_COMPLEX" &&
      (error.extensions.http as { status?: number })?.status === 400
  );
  assert.deepEqual(observations, [
    {
      operationName: "TooWide",
      actualComplexity: 21,
      maximumComplexity: 10,
      rejected: true,
    },
  ]);
});

test("reports accepted operation complexity without query text or variables", async () => {
  const observations: unknown[] = [];
  const plugin = queryComplexityPlugin({
    maximumComplexity: 10,
    report: (observation) => observations.push(observation),
  });
  const hooks = await plugin.requestDidStart!({} as never);

  await hooks!.didResolveOperation!({
    document: parse("query Small { item { id } }"),
    request: { operationName: "Small", variables: { secret: "not logged" } },
    schema,
  } as never);

  assert.deepEqual(observations, [
    {
      operationName: "Small",
      actualComplexity: 2,
      maximumComplexity: 10,
      rejected: false,
    },
  ]);
});

test("returns an HTTP 400 response with a dedicated error code", async () => {
  const server = new ApolloServer({
    schema,
    plugins: [queryComplexityPlugin({ maximumComplexity: 10 })],
  });
  await server.start();

  try {
    const headers = new HeaderMap();
    headers.set("content-type", "application/json");
    const response = await server.executeHTTPGraphQLRequest({
      httpGraphQLRequest: {
        method: "POST",
        headers,
        search: "",
        body: {
          operationName: "TooWide",
          query: "query TooWide { items(limit: 20) { id } }",
        },
      },
      context: async () => ({}),
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.kind, "complete");
    if (response.body.kind !== "complete") return;
    const body = JSON.parse(response.body.string) as {
      errors?: Array<{ extensions?: { code?: string } }>;
    };
    assert.equal(body.errors?.[0]?.extensions?.code, "QUERY_TOO_COMPLEX");
  } finally {
    await server.stop();
  }
});

test("reads a positive integer ceiling and falls back for invalid values", () => {
  assert.equal(resolveMaxQueryComplexity("1234"), 1234);
  assert.equal(resolveMaxQueryComplexity("0"), DEFAULT_MAX_QUERY_COMPLEXITY);
  assert.equal(resolveMaxQueryComplexity("invalid"), DEFAULT_MAX_QUERY_COMPLEXITY);
});
