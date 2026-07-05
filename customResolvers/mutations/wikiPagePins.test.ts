import test from "node:test";
import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import {
  pinWikiPageToChannel,
  unpinWikiPageFromChannel,
} from "./wikiPagePins.js";

type ModelFindArgs = {
  where: Record<string, unknown>;
  selectionSet?: string;
};

const buildModels = ({
  channel = { uniqueName: "cats", wikiEnabled: true },
  wikiPage = { id: "wiki-1", channelUniqueName: "cats" },
}: {
  channel?: Record<string, unknown> | null;
  wikiPage?: Record<string, unknown> | null;
} = {}) => ({
  Channel: {
    find: async (_args: ModelFindArgs) => (channel ? [channel] : []),
  },
  WikiPage: {
    find: async (_args: ModelFindArgs) => (wikiPage ? [wikiPage] : []),
  },
});

const buildDriver = () => {
  const calls = {
    sessions: [] as Record<string, unknown>[],
    writes: [] as Array<{ query: string; params: Record<string, unknown> }>,
    closed: 0,
  };

  const driver = {
    session: (options: Record<string, unknown>) => {
      calls.sessions.push(options);
      return {
        run: async (query: string, params: Record<string, unknown>) => {
          calls.writes.push({ query, params });
          return { records: [] };
        },
        close: async () => {
          calls.closed += 1;
        },
      };
    },
  };

  return { driver, calls };
};

const context = {} as GraphQLContext;

test("pinWikiPageToChannel delegates authorization to canUpdateChannel and merges the pin", async () => {
  const models = buildModels();
  const { driver, calls } = buildDriver();
  const permissionCalls: unknown[] = [];
  const resolver = pinWikiPageToChannel({
    driver: driver as never,
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async (input) => {
      permissionCalls.push(input);
      return true;
    },
  });

  const result = await resolver(
    null,
    { channelUniqueName: "cats", wikiPageId: "wiki-1" },
    context
  );

  assert.deepEqual(
    {
      result,
      permissionCalls,
      writeParams: calls.writes[0].params,
      usesMerge: /MERGE \(channel\)-\[:PINNED_IN_CHANNEL\]->\(wikiPage\)/.test(
        calls.writes[0].query
      ),
      session: calls.sessions[0],
      closed: calls.closed,
    },
    {
      result: true,
      permissionCalls: [
        {
          channelConnections: ["cats"],
          context,
          permissionCheck: "canUpdateChannel",
        },
      ],
      writeParams: { channelUniqueName: "cats", wikiPageId: "wiki-1" },
      usesMerge: true,
      session: { defaultAccessMode: "WRITE" },
      closed: 1,
    }
  );
});

test("unpinWikiPageFromChannel deletes the pin relationship", async () => {
  const models = buildModels();
  const { driver, calls } = buildDriver();
  const resolver = unpinWikiPageFromChannel({
    driver: driver as never,
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async () => true,
  });

  const result = await resolver(
    null,
    { channelUniqueName: "cats", wikiPageId: "wiki-1" },
    context
  );

  assert.deepEqual(
    {
      result,
      deletesRelationship: /DELETE relationship/.test(calls.writes[0].query),
      params: calls.writes[0].params,
    },
    {
      result: true,
      deletesRelationship: true,
      params: { channelUniqueName: "cats", wikiPageId: "wiki-1" },
    }
  );
});

test("pinWikiPageToChannel rejects wiki pages from another forum", async () => {
  const models = buildModels({
    wikiPage: { id: "wiki-1", channelUniqueName: "dogs" },
  });
  const { driver, calls } = buildDriver();
  const resolver = pinWikiPageToChannel({
    driver: driver as never,
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async () => {
      throw new Error("permission should not be checked");
    },
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { channelUniqueName: "cats", wikiPageId: "wiki-1" },
        context
      ),
    /does not belong to this forum/
  );
  assert.equal(calls.writes.length, 0);
});

test("pinWikiPageToChannel rejects disabled wiki channels", async () => {
  const models = buildModels({
    channel: { uniqueName: "cats", wikiEnabled: false },
  });
  const { driver, calls } = buildDriver();
  const resolver = pinWikiPageToChannel({
    driver: driver as never,
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async () => true,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { channelUniqueName: "cats", wikiPageId: "wiki-1" },
        context
      ),
    /Wiki is disabled/
  );
  assert.equal(calls.writes.length, 0);
});

test("pinWikiPageToChannel surfaces role permission failures", async () => {
  const models = buildModels();
  const { driver, calls } = buildDriver();
  const resolver = pinWikiPageToChannel({
    driver: driver as never,
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async () => new Error("No channel permission"),
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { channelUniqueName: "cats", wikiPageId: "wiki-1" },
        context
      ),
    /No channel permission/
  );
  assert.equal(calls.writes.length, 0);
});
