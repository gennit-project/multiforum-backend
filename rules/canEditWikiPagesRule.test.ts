import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCanEditWikiHomePageRule,
  evaluateCanEditWikiPagesRule,
} from "./rules.js";

type BuildOgmInput = {
  defaultCanUpdateChannel?: boolean;
  suspendedCanUpdateChannel?: boolean;
  suspendedUsers?: Array<{ username: string }>;
  wikiPages?: Array<{ channelUniqueName: string }>;
};

const buildOgm = ({
  defaultCanUpdateChannel = true,
  suspendedCanUpdateChannel = false,
  suspendedUsers = [],
  wikiPages = [],
}: BuildOgmInput = {}) => ({
  model: (name: string) => {
    if (name === "Channel") {
      return {
        find: async () => [
          {
            Admins: [],
            DefaultChannelRole: {
              canUpdateChannel: defaultCanUpdateChannel,
            },
            SuspendedRole: {
              canUpdateChannel: suspendedCanUpdateChannel,
            },
            SuspendedUsers: suspendedUsers.map((user) => ({
              id: `suspension-${user.username}`,
              username: user.username,
              suspendedIndefinitely: true,
              suspendedUntil: null,
            })),
            SuspendedMods: [],
          },
        ],
      };
    }

    if (name === "ServerConfig") {
      return {
        find: async () => [
          {
            DefaultServerRole: { canUpdateChannel: defaultCanUpdateChannel },
            DefaultSuspendedRole: {
              canUpdateChannel: suspendedCanUpdateChannel,
            },
          },
        ],
      };
    }

    if (name === "User") {
      return {
        find: async () => [
          {
            notifyOnSuspensionBlocks: true,
            Notifications: [],
          },
        ],
        update: async () => ({}),
      };
    }

    if (name === "WikiPage") {
      return {
        find: async () => wikiPages,
      };
    }

    throw new Error(`Unexpected model lookup: ${name}`);
  },
});

const buildContext = (input: BuildOgmInput = {}) => ({
  ogm: buildOgm(input),
  req: { headers: {} },
  user: {
    username: "wiki-author",
    data: {},
  },
});

test("allows wiki page updates when the channel role can update the channel", async () => {
  const ctx = buildContext({
    wikiPages: [{ channelUniqueName: "sourceit" }],
  });

  const result = await evaluateCanEditWikiPagesRule(
    { where: { id: "wiki-page-1" }, update: { body: "Updated" } },
    ctx
  );

  assert.equal(result, true);
});

test("blocks wiki page updates for suspended users when the suspended role cannot update the channel", async () => {
  const ctx = buildContext({
    suspendedUsers: [{ username: "wiki-author" }],
    wikiPages: [{ channelUniqueName: "sourceit" }],
  });

  const result = await evaluateCanEditWikiPagesRule(
    { where: { id: "wiki-page-1" }, update: { body: "Updated" } },
    ctx
  );

  assert.ok(result instanceof Error);
});

test("checks child wiki page creation against the parent page channel", async () => {
  const ctx = buildContext({
    suspendedUsers: [{ username: "wiki-author" }],
    wikiPages: [{ channelUniqueName: "sourceit" }],
  });

  const result = await evaluateCanEditWikiPagesRule(
    {
      where: { id: "wiki-home" },
      update: {
        ChildPages: [
          {
            create: [
              {
                node: {
                  channelUniqueName: "sourceit",
                  slug: "child",
                  title: "Child",
                },
              },
            ],
          },
        ],
      },
    },
    ctx
  );

  assert.ok(result instanceof Error);
});

test("checks wiki home page updates that flow through updateChannels", async () => {
  const ctx = buildContext({
    suspendedUsers: [{ username: "wiki-author" }],
  });

  const result = await evaluateCanEditWikiHomePageRule(
    {
      where: { uniqueName: "sourceit" },
      update: { WikiHomePage: { update: { node: { body: "Updated" } } } },
    },
    ctx
  );

  assert.ok(result instanceof Error);
});

test("allows unrelated channel updates to keep existing updateChannels behavior", async () => {
  const ctx = buildContext({
    suspendedUsers: [{ username: "wiki-author" }],
  });

  const result = await evaluateCanEditWikiHomePageRule(
    {
      where: { uniqueName: "sourceit" },
      update: { description: "Updated" },
    },
    ctx
  );

  assert.equal(result, true);
});
