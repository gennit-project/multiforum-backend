import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCanDeleteWikiPagesRule,
  evaluateCanEditWikiHomePageRule,
  evaluateCanEditWikiPagesRule,
} from "./rules.js";
import { ModChannelPermission } from "./permission/hasChannelModPermission.js";

type BuildOgmInput = {
  defaultCanUpdateChannel?: boolean;
  suspendedCanUpdateChannel?: boolean;
  suspendedUsers?: Array<{ username: string }>;
  channels?: Array<{
    uniqueName: string;
    wikiEnabled?: boolean;
  }>;
  wikiPages?: Array<{
    id?: string;
    channelUniqueName: string;
    OriginalAuthor?: { username: string };
    ChildPages?: Array<{ id: string }>;
  }>;
};

const buildOgm = ({
  defaultCanUpdateChannel = true,
  suspendedCanUpdateChannel = false,
  suspendedUsers = [],
  channels = [],
  wikiPages = [],
}: BuildOgmInput = {}) => ({
  model: (name: string) => {
    if (name === "Channel") {
      return {
        find: async ({ where }: { where?: { uniqueName?: string } } = {}) => {
          const channel = channels.find(
            (item) => item.uniqueName === where?.uniqueName
          );

          return [
            {
              uniqueName: where?.uniqueName,
              wikiEnabled: channel?.wikiEnabled,
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
          ];
        },
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
        find: async ({ where }: { where?: { id?: string; id_IN?: string[] } }) => {
          if (where?.id) {
            return wikiPages.filter((wikiPage) => wikiPage.id === where.id);
          }

          if (where?.id_IN?.length) {
            return wikiPages.filter(
              (wikiPage) => wikiPage.id && where.id_IN?.includes(wikiPage.id)
            );
          }

          return wikiPages;
        },
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
    wikiPages: [{ id: "wiki-page-1", channelUniqueName: "sourceit" }],
  });

  const result = await evaluateCanEditWikiPagesRule(
    { where: { id: "wiki-page-1" }, update: { body: "Updated" } },
    ctx
  );

  assert.equal(result, true);
});

test("blocks wiki page creation when wiki is disabled for the channel", async () => {
  const ctx = buildContext({
    channels: [{ uniqueName: "sourceit", wikiEnabled: false }],
  });

  const result = await evaluateCanEditWikiPagesRule(
    {
      input: [
        {
          channelUniqueName: "sourceit",
          slug: "disabled-wiki",
          title: "Disabled Wiki",
          body: "This should not be created.",
        },
      ],
    },
    ctx
  );

  assert.ok(result instanceof Error);
});

test("blocks wiki page updates for suspended users when the suspended role cannot update the channel", async () => {
  const ctx = buildContext({
    suspendedUsers: [{ username: "wiki-author" }],
    wikiPages: [{ id: "wiki-page-1", channelUniqueName: "sourceit" }],
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
    wikiPages: [{ id: "wiki-home", channelUniqueName: "sourceit" }],
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

test("blocks wiki home page updates when wiki is disabled for the channel", async () => {
  const ctx = buildContext({
    channels: [{ uniqueName: "sourceit", wikiEnabled: false }],
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

test("allows original wiki page authors to delete their pages", async () => {
  const ctx = buildContext({
    wikiPages: [
      {
        id: "wiki-page-1",
        channelUniqueName: "sourceit",
        OriginalAuthor: { username: "wiki-author" },
      },
    ],
  });

  const result = await evaluateCanDeleteWikiPagesRule(
    { where: { id: "wiki-page-1" } },
    ctx
  );

  assert.equal(result, true);
});

test("blocks deleting wiki pages that have child pages", async () => {
  const ctx = buildContext({
    wikiPages: [
      {
        id: "wiki-page-1",
        channelUniqueName: "sourceit",
        OriginalAuthor: { username: "wiki-author" },
        ChildPages: [{ id: "child-page-1" }],
      },
    ],
  });

  const result = await evaluateCanDeleteWikiPagesRule(
    { where: { id: "wiki-page-1" } },
    ctx
  );

  assert.ok(result instanceof Error);
});

test("checks the dedicated wiki delete permission for non-author page deletion", async () => {
  const ctx = buildContext({
    wikiPages: [
      {
        id: "wiki-page-1",
        channelUniqueName: "sourceit",
        OriginalAuthor: { username: "page-creator" },
      },
    ],
  });
  const permissionCalls: Array<{
    channelConnections: string[];
    permissionCheck: ModChannelPermission;
  }> = [];

  const result = await evaluateCanDeleteWikiPagesRule(
    { where: { id: "wiki-page-1" } },
    ctx,
    async ({ channelConnections, permissionCheck }) => {
      permissionCalls.push({ channelConnections, permissionCheck });
      return true;
    }
  );

  assert.equal(result, true);
  assert.deepEqual(permissionCalls, [
    {
      channelConnections: ["sourceit"],
      permissionCheck: ModChannelPermission.canDeleteWiki,
    },
  ]);
});

test("blocks wiki page deletion when the user is not the original author or a permitted mod", async () => {
  const ctx = buildContext({
    wikiPages: [
      {
        id: "wiki-page-1",
        channelUniqueName: "sourceit",
        OriginalAuthor: { username: "page-creator" },
      },
    ],
  });

  const result = await evaluateCanDeleteWikiPagesRule(
    { where: { id: "wiki-page-1" } },
    ctx,
    async () => new Error("No permission")
  );

  assert.ok(result instanceof Error);
});
