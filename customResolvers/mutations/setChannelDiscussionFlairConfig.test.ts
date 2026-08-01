import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { setChannelDiscussionFlairConfig } from "./setChannelDiscussionFlairConfig.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const configRecord = ({
  flairRequired,
  flairs,
}: {
  flairRequired: boolean;
  flairs: Array<Record<string, unknown>>;
}) =>
  record({
    channelUniqueName: "gardening",
    flairRequired,
    flairs,
  });

const existingFlairs = [
  {
    id: "existing",
    channelUniqueName: "gardening",
    displayName: "Question",
    color: "#2563EB",
    order: 0,
    archived: false,
  },
  {
    id: "omitted",
    channelUniqueName: "gardening",
    displayName: "Old category",
    color: null,
    order: 1,
    archived: false,
  },
];

const context = {
  user: { username: "channel-owner" },
} as GraphQLContext;

test("updates, creates, and archives omitted flairs atomically", async () => {
  const writeCalls: Array<{
    query: string;
    params?: Record<string, unknown>;
  }> = [];
  let configReads = 0;
  let closed = false;

  const transaction = {
    run: async (query: string, params?: Record<string, unknown>) => {
      if (query.includes("AS flairs")) {
        configReads += 1;
        return {
          records: [
            configReads === 1
              ? configRecord({ flairRequired: false, flairs: existingFlairs })
              : configRecord({
                  flairRequired: true,
                  flairs: [
                    {
                      ...existingFlairs[0],
                      displayName: "Help",
                      color: "#DC2626",
                    },
                    { ...existingFlairs[1], archived: true },
                    {
                      id: "generated-id",
                      channelUniqueName: "gardening",
                      displayName: "Showcase",
                      color: null,
                      order: 1,
                      archived: false,
                    },
                  ],
                }),
          ],
        };
      }

      writeCalls.push({ query, params });
      return { records: [] };
    },
  };

  const driver = {
    session: () => ({
      executeWrite: async (
        callback: (tx: typeof transaction) => Promise<unknown>
      ) => callback(transaction),
      close: async () => {
        closed = true;
      },
    }),
  };

  const resolver = setChannelDiscussionFlairConfig({
    driver: driver as never,
    createId: () => "generated-id",
  });
  const result = await resolver(
    null,
    {
      channelUniqueName: "gardening",
      flairRequired: true,
      flairs: [
        {
          id: "existing",
          displayName: "Help",
          color: "#dc2626",
          order: 0,
          archived: false,
        },
        {
          displayName: "Showcase",
          order: 1,
          archived: false,
        },
      ],
    },
    context
  );

  assert.equal(result.flairRequired, true);
  assert.equal(result.flairs.length, 3);
  assert.equal(result.flairs[1].archived, true);
  assert.equal(configReads, 2);
  assert.equal(writeCalls.length, 3);
  assert.deepEqual(writeCalls[0].params, {
    channelUniqueName: "gardening",
    flairRequired: true,
    submittedIds: ["existing", "generated-id"],
  });
  assert.deepEqual(writeCalls[1].params, {
    channelUniqueName: "gardening",
    flairs: [
      {
        id: "existing",
        displayName: "Help",
        color: "#DC2626",
        order: 0,
        archived: false,
      },
    ],
  });
  assert.deepEqual(writeCalls[2].params, {
    channelUniqueName: "gardening",
    flairs: [
      {
        id: "generated-id",
        displayName: "Showcase",
        color: null,
        order: 1,
        archived: false,
      },
    ],
  });
  assert.equal(closed, true);
});

test("rejects a flair ID that does not belong to the channel", async () => {
  let writeCount = 0;
  const transaction = {
    run: async (query: string) => {
      if (query.includes("AS flairs")) {
        return {
          records: [
            configRecord({ flairRequired: false, flairs: existingFlairs }),
          ],
        };
      }
      writeCount += 1;
      return { records: [] };
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (
        callback: (tx: typeof transaction) => Promise<unknown>
      ) => callback(transaction),
      close: async () => {},
    }),
  };
  const resolver = setChannelDiscussionFlairConfig({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        {
          channelUniqueName: "gardening",
          flairRequired: false,
          flairs: [
            {
              id: "belongs-to-another-channel",
              displayName: "Question",
              order: 0,
              archived: false,
            },
          ],
        },
        context
      ),
    /does not belong to channel/
  );

  assert.equal(writeCount, 0);
});

test("reports a missing channel before writing", async () => {
  const transaction = {
    run: async () => ({ records: [] }),
  };
  const driver = {
    session: () => ({
      executeWrite: async (
        callback: (tx: typeof transaction) => Promise<unknown>
      ) => callback(transaction),
      close: async () => {},
    }),
  };
  const resolver = setChannelDiscussionFlairConfig({ driver: driver as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        {
          channelUniqueName: "missing",
          flairRequired: false,
          flairs: [],
        },
        context
      ),
    /Channel not found/
  );
});
