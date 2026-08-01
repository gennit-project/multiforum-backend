import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { getChannelDiscussionFlairConfig } from "./getChannelDiscussionFlairConfig.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

test("returns active flair configuration and closes the session", async () => {
  let closed = false;
  const calls: Array<Record<string, unknown> | undefined> = [];
  const driver = {
    session: () => ({
      run: async (_query: string, params?: Record<string, unknown>) => {
        calls.push(params);
        return {
          records: [
            record({
              channelUniqueName: "gardening",
              flairRequired: true,
              flairs: [
                {
                  id: "question",
                  channelUniqueName: "gardening",
                  displayName: "Question",
                  color: "#2563EB",
                  order: neo4j.int(0),
                  archived: false,
                },
              ],
            }),
          ],
        };
      },
      close: async () => {
        closed = true;
      },
    }),
  };

  const resolver = getChannelDiscussionFlairConfig({ driver: driver as never });
  const result = await resolver(null, {
    channelUniqueName: " gardening ",
  });

  assert.deepEqual(result, {
    channelUniqueName: "gardening",
    flairRequired: true,
    flairs: [
      {
        id: "question",
        channelUniqueName: "gardening",
        displayName: "Question",
        color: "#2563EB",
        order: 0,
        archived: false,
      },
    ],
  });
  assert.deepEqual(calls[0], {
    channelUniqueName: "gardening",
    includeArchived: false,
  });
  assert.equal(closed, true);
});

test("reports a missing channel", async () => {
  const driver = {
    session: () => ({
      run: async () => ({ records: [] }),
      close: async () => {},
    }),
  };
  const resolver = getChannelDiscussionFlairConfig({ driver: driver as never });

  await assert.rejects(
    () => resolver(null, { channelUniqueName: "missing" }),
    /Channel not found/
  );
});
