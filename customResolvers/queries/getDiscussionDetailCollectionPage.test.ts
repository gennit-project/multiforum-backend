import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { decodeDetailCollectionCursor } from "../../services/detailCollectionCursor.js";
import { createDiscussionDetailCollectionPageResolver } from "./getDiscussionDetailCollectionPage.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const context = {
  mayAccessSensitiveContent: false,
} as unknown as GraphQLContext;

test("detail collection pages return the requested limit and a cursor", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let closed = false;
  const records = ["answer-1", "answer-2", "answer-3"].map((id, index) =>
    record({
      item: { id },
      cursorCreatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      cursorId: id,
    })
  );
  const driver = {
    session: () => ({
      executeWrite: async (work: (transaction: { run: (query: string, params: Record<string, unknown>) => Promise<{ records: typeof records }> }) => Promise<unknown>) =>
        work({
          run: async (_query, params) => {
            calls.push(params);
            return { records };
          },
        }),
      close: async () => {
        closed = true;
      },
    }),
  };
  const resolver = createDiscussionDetailCollectionPageResolver({
    driver: driver as never,
    kind: "answer",
  });

  const result = await resolver(
    null,
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      limit: 2,
    },
    context
  );

  assert.deepEqual(
    {
      result,
      params: calls[0],
      decodedCursor: decodeDetailCollectionCursor({
        after: result.pageInfo.endCursor,
        expectedKind: "answer",
      }),
      closed,
    },
    {
      result: {
        answers: [{ id: "answer-1" }, { id: "answer-2" }],
        pageInfo: {
          endCursor: result.pageInfo.endCursor,
          hasNextPage: true,
        },
      },
      params: {
        discussionId: "discussion-1",
        channelUniqueName: "cats",
        mayAccessSensitiveContent: false,
        cursorCreatedAt: null,
        cursorId: null,
        pageLimit: 3,
      },
      decodedCursor: {
        kind: "answer",
        createdAt: "2026-01-02T00:00:00.000Z",
        id: "answer-2",
      },
      closed: true,
    }
  );
});

test("detail collection pages pass a decoded cursor to Cypher", async () => {
  let params: Record<string, unknown> | undefined;
  const driver = {
    session: () => ({
      executeWrite: async (work: (transaction: { run: (query: string, queryParams: Record<string, unknown>) => Promise<{ records: never[] }> }) => Promise<unknown>) =>
        work({
          run: async (_query, queryParams) => {
            params = queryParams;
            return { records: [] };
          },
        }),
      close: async () => undefined,
    }),
  };
  const resolver = createDiscussionDetailCollectionPageResolver({
    driver: driver as never,
    kind: "image",
  });
  const after = Buffer.from(
    JSON.stringify({
      v: 1,
      k: "image",
      c: "2026-02-03T04:05:06.000Z",
      i: "image-12",
    })
  ).toString("base64url");

  const result = await resolver(
    null,
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      after,
    },
    context
  );

  assert.deepEqual(
    { params, result },
    {
      params: {
        discussionId: "discussion-1",
        channelUniqueName: "cats",
        mayAccessSensitiveContent: false,
        cursorCreatedAt: "2026-02-03T04:05:06.000Z",
        cursorId: "image-12",
        pageLimit: 13,
      },
      result: {
        images: [],
        pageInfo: { endCursor: null, hasNextPage: false },
      },
    }
  );
});
