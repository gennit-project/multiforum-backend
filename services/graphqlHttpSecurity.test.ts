import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  createGraphQLJsonBodyParser,
  GRAPHQL_JSON_BODY_LIMIT_BYTES,
  graphqlPayloadTooLargeErrorHandler,
} from "./graphqlHttpSecurity.js";

const withTestServer = async (
  run: (url: string, executions: () => number) => Promise<void>
) => {
  const app = express();
  let executionCount = 0;
  app.post(
    "/",
    createGraphQLJsonBodyParser(),
    graphqlPayloadTooLargeErrorHandler,
    (_req: Request, res: Response) => {
      executionCount += 1;
      res.json({ data: { accepted: true } });
    }
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}/`, () => executionCount);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
};

test("accepts representative operation and upload metadata well below the limit", async () => {
  const request = {
    operationName: "CreateDownload",
    query: "mutation CreateDownload($input: JSON!) { createDownload(input: $input) }",
    variables: {
      input: {
        title: "Example download",
        description: "x".repeat(256 * 1024),
        storageUrl: "https://storage.example/downloads/example.zip",
        checksum: "a".repeat(64),
        contentType: "application/zip",
      },
    },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < GRAPHQL_JSON_BODY_LIMIT_BYTES);

  await withTestServer(async (url, executions) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    assert.equal(executions(), 1);
  });
});

test("rejects oversized JSON before GraphQL execution with a structured 413", async () => {
  await withTestServer(async (url, executions) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "mutation Oversized($input: String!) { oversized(input: $input) }",
        variables: { input: "x".repeat(GRAPHQL_JSON_BODY_LIMIT_BYTES) },
      }),
    });
    assert.equal(response.status, 413);
    assert.equal(executions(), 0);
    assert.deepEqual(await response.json(), {
      errors: [
        {
          message: "GraphQL request body must not exceed 1 MiB.",
          extensions: {
            code: "PAYLOAD_TOO_LARGE",
            maximumBytes: GRAPHQL_JSON_BODY_LIMIT_BYTES,
          },
        },
      ],
    });
  });
});

test("delegates errors that are unrelated to the body limit", () => {
  const error = new Error("malformed JSON");
  let delegated: unknown;
  graphqlPayloadTooLargeErrorHandler(
    error,
    {} as Request,
    {} as Response,
    ((received: unknown) => {
      delegated = received;
    }) as NextFunction
  );
  assert.equal(delegated, error);
});
