import test from "node:test";
import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import {
  lockWikiPage,
  unlockWikiPage,
} from "./wikiPageLocks.js";

type WikiPageRecord = {
  id: string;
  title?: string;
  slug?: string;
  channelUniqueName: string;
  locked?: boolean | null;
};

type LockedWikiPageResult = WikiPageRecord & {
  lockReason?: string | null;
  lockedByUsername?: string | null;
};

const buildContext = ({
  wikiPage = { id: "wiki-1", channelUniqueName: "cats", locked: false },
  channel = {
    uniqueName: "cats",
    wikiEnabled: true,
    Admins: [{ username: "alice" }],
    ElevatedChannelRole: { canUpdateChannel: true },
  },
}: {
  wikiPage?: WikiPageRecord | null;
  channel?: Record<string, unknown> | null;
} = {}) =>
  ({
    user: { username: "alice", data: {} },
    ogm: {
      model: (name: string) => {
        if (name === "WikiPage") {
          return {
            find: async () => (wikiPage ? [wikiPage] : []),
          };
        }

        if (name === "Channel") {
          return {
            find: async () => (channel ? [channel] : []),
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  } as unknown as GraphQLContext);

const buildWikiPageModel = () => {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    WikiPage: {
      update: async (input: Record<string, unknown>) => {
        calls.push(input);
        const update = input.update as Record<string, unknown>;
        return {
          wikiPages: [
            {
              id: "wiki-1",
              title: "Intro",
              slug: "intro",
              channelUniqueName: "cats",
              locked: update.locked,
              lockedAt: update.lockedAt,
              lockReason: update.lockReason,
              lockedByUsername: update.lockedByUsername,
            },
          ],
        };
      },
    },
  };
};

test("lockWikiPage records lock metadata for a channel owner", async () => {
  const { WikiPage, calls } = buildWikiPageModel();
  const resolver = lockWikiPage({ WikiPage: WikiPage as never });

  const result = (await resolver(
    null,
    { wikiPageId: "wiki-1", reason: "Settled canon" },
    buildContext()
  )) as LockedWikiPageResult;

  assert.deepEqual(
    {
      locked: result.locked,
      lockReason: result.lockReason,
      lockedByUsername: result.lockedByUsername,
      update: calls[0].update,
    },
    {
      locked: true,
      lockReason: "Settled canon",
      lockedByUsername: "alice",
      update: {
        locked: true,
        lockedAt: (calls[0].update as Record<string, unknown>).lockedAt,
        lockReason: "Settled canon",
        lockedByUsername: "alice",
      },
    }
  );
});

test("unlockWikiPage clears lock metadata", async () => {
  const { WikiPage, calls } = buildWikiPageModel();
  const resolver = unlockWikiPage({ WikiPage: WikiPage as never });

  const result = (await resolver(
    null,
    { wikiPageId: "wiki-1" },
    buildContext({
      wikiPage: { id: "wiki-1", channelUniqueName: "cats", locked: true },
    })
  )) as LockedWikiPageResult;

  assert.deepEqual(
    {
      locked: result.locked,
      update: calls[0].update,
    },
    {
      locked: false,
      update: {
        locked: false,
        lockedAt: null,
        lockReason: null,
        lockedByUsername: null,
      },
    }
  );
});

test("lockWikiPage rejects non-owner callers", async () => {
  const { WikiPage, calls } = buildWikiPageModel();
  const resolver = lockWikiPage({ WikiPage: WikiPage as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { wikiPageId: "wiki-1", reason: "Settled canon" },
        buildContext({
          channel: {
            uniqueName: "cats",
            wikiEnabled: true,
            Admins: [{ username: "bob" }],
            ElevatedChannelRole: { canUpdateChannel: true },
          },
        })
      ),
    /permission/i
  );
  assert.equal(calls.length, 0);
});

test("lockWikiPage rejects already locked pages", async () => {
  const { WikiPage, calls } = buildWikiPageModel();
  const resolver = lockWikiPage({ WikiPage: WikiPage as never });

  await assert.rejects(
    () =>
      resolver(
        null,
        { wikiPageId: "wiki-1", reason: "Settled canon" },
        buildContext({
          wikiPage: { id: "wiki-1", channelUniqueName: "cats", locked: true },
        })
      ),
    /already locked/
  );
  assert.equal(calls.length, 0);
});
