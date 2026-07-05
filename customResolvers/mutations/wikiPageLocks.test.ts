import test from "node:test";
import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import {
  lockWikiPage,
  unlockWikiPage,
} from "./wikiPageLocks.js";

type ModelFindArgs = {
  where: Record<string, unknown>;
  selectionSet?: string;
};

type ModelUpdateArgs = {
  where: Record<string, unknown>;
  update: Record<string, unknown>;
  selectionSet?: string;
};

const buildModels = ({
  channel = { uniqueName: "cats", wikiEnabled: true },
  wikiPage = { id: "wiki-1", channelUniqueName: "cats", locked: false },
}: {
  channel?: Record<string, unknown> | null;
  wikiPage?: Record<string, unknown> | null;
} = {}) => {
  const calls = {
    updates: [] as ModelUpdateArgs[],
  };

  return {
    calls,
    Channel: {
      find: async (_args: ModelFindArgs) => (channel ? [channel] : []),
    },
    WikiPage: {
      find: async (_args: ModelFindArgs) => (wikiPage ? [wikiPage] : []),
      update: async (args: ModelUpdateArgs) => {
        calls.updates.push(args);
        return {
          wikiPages: [
            {
              ...wikiPage,
              ...args.update,
            },
          ],
        };
      },
    },
  };
};

const context = {
  user: { username: "modder" },
} as GraphQLContext;

test("lockWikiPage delegates authorization and writes lock metadata", async () => {
  const models = buildModels();
  const permissionCalls: unknown[] = [];
  const resolver = lockWikiPage({
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async (input) => {
      permissionCalls.push(input);
      return true;
    },
  });

  const result = await resolver(
    null,
    { channelUniqueName: "cats", wikiPageId: "wiki-1", reason: "Spam edits" },
    context
  );

  assert.deepEqual(
    {
      result: {
        id: result.id,
        locked: result.locked,
        lockReason: result.lockReason,
        lockedByUsername: result.lockedByUsername,
      },
      permissionCalls,
      update: {
        locked: models.calls.updates[0].update.locked,
        lockReason: models.calls.updates[0].update.lockReason,
        lockedByUsername: models.calls.updates[0].update.lockedByUsername,
      },
    },
    {
      result: {
        id: "wiki-1",
        locked: true,
        lockReason: "Spam edits",
        lockedByUsername: "modder",
      },
      permissionCalls: [
        {
          channelConnections: ["cats"],
          context,
          permissionCheck: "canDeleteWiki",
        },
      ],
      update: {
        locked: true,
        lockReason: "Spam edits",
        lockedByUsername: "modder",
      },
    }
  );
});

test("unlockWikiPage clears lock metadata", async () => {
  const models = buildModels({
    wikiPage: { id: "wiki-1", channelUniqueName: "cats", locked: true },
  });
  const resolver = unlockWikiPage({
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
      locked: result.locked,
      lockedAt: result.lockedAt,
      lockReason: result.lockReason,
      lockedByUsername: result.lockedByUsername,
    },
    {
      locked: false,
      lockedAt: null,
      lockReason: null,
      lockedByUsername: null,
    }
  );
});

test("lockWikiPage rejects callers without wiki moderation permission", async () => {
  const models = buildModels();
  const resolver = lockWikiPage({
    Channel: models.Channel as never,
    WikiPage: models.WikiPage as never,
    checkPermissions: async () => new Error("No wiki permission"),
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { channelUniqueName: "cats", wikiPageId: "wiki-1", reason: "Spam" },
        context
      ),
    /No wiki permission/
  );
  assert.equal(models.calls.updates.length, 0);
});

test("lockWikiPage rejects an already locked wiki page", async () => {
  const models = buildModels({
    wikiPage: { id: "wiki-1", channelUniqueName: "cats", locked: true },
  });
  const resolver = lockWikiPage({
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
        { channelUniqueName: "cats", wikiPageId: "wiki-1", reason: "Spam" },
        context
      ),
    /already locked/
  );
  assert.equal(models.calls.updates.length, 0);
});

test("unlockWikiPage rejects an unlocked wiki page", async () => {
  const models = buildModels();
  const resolver = unlockWikiPage({
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
    /not locked/
  );
  assert.equal(models.calls.updates.length, 0);
});
