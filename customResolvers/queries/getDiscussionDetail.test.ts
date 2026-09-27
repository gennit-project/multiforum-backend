import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import getDiscussionDetail from "./getDiscussionDetail.js";

type QueryCall = {
  query: string;
  params: Record<string, unknown>;
};

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const createDriver = (results: Array<Record<string, unknown>>) => {
  const calls: QueryCall[] = [];
  let closed = false;
  return {
    calls,
    wasClosed: () => closed,
    driver: {
      session: () => ({
        executeWrite: async (
          work: (transaction: {
            run: (
              query: string,
              params: Record<string, unknown>
            ) => Promise<{ records: Array<ReturnType<typeof record>> }>;
          }) => Promise<unknown>
        ) => {
          let index = 0;
          return work({
            run: async (query, params) => {
              calls.push({ query, params });
              const values = results[index++];
              return { records: values ? [record(values)] : [] };
            },
          });
        },
        close: async () => {
          closed = true;
        },
      }),
    },
  };
};

const context = {
  user: {
    username: "viewer",
    email: null,
    email_verified: true,
    data: { ModerationProfile: { displayName: "mod-viewer" } },
  },
  mayAccessSensitiveContent: false,
} as unknown as GraphQLContext;

test("getDiscussionDetail combines three bounded reads", async () => {
  const mock = createDriver([
    { Discussion: { id: "discussion-1", title: "Hello" } },
    { DiscussionChannel: { id: "entry-1" } },
    { DownloadableFiles: [{ id: "file-1" }] },
  ]);
  const resolver = getDiscussionDetail({
    driver: mock.driver as never,
  });

  const result = await resolver(
    null,
    { discussionId: "discussion-1", channelUniqueName: "cats" },
    context
  );

  assert.deepEqual(
    {
      result,
      callCount: mock.calls.length,
      params: mock.calls[0]?.params,
      closed: mock.wasClosed(),
    },
    {
      result: [{
        id: "discussion-1",
        title: "Hello",
        DiscussionChannels: [{ id: "entry-1" }],
        DownloadableFiles: [{ id: "file-1" }],
      }],
      callCount: 3,
      params: {
        discussionId: "discussion-1",
        channelUniqueName: "cats",
        viewerUsername: "viewer",
        viewerModName: "mod-viewer",
        mayAccessSensitiveContent: false,
        imageLimit: 50,
        previewImageLimit: 12,
        answerLimit: 20,
        fileLimit: 50,
      },
      closed: true,
    }
  );
});

test("getDiscussionDetail stops after an unknown or hidden discussion", async () => {
  const mock = createDriver([]);
  const resolver = getDiscussionDetail({
    driver: mock.driver as never,
  });

  const result = await resolver(
    null,
    { discussionId: "missing", channelUniqueName: "cats" },
    context
  );

  assert.deepEqual(
    { result, callCount: mock.calls.length, closed: mock.wasClosed() },
    { result: [], callCount: 1, closed: true }
  );
});

test("getDiscussionDetail requires membership in the requested channel", async () => {
  const mock = createDriver([
    { Discussion: { id: "discussion-1", title: "Hello" } },
    {},
  ]);
  const resolver = getDiscussionDetail({
    driver: mock.driver as never,
  });

  const result = await resolver(
    null,
    { discussionId: "discussion-1", channelUniqueName: "wrong-channel" },
    context
  );

  assert.deepEqual(
    { result, callCount: mock.calls.length, closed: mock.wasClosed() },
    { result: [], callCount: 2, closed: true }
  );
});
