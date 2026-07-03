import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import type {
  ChannelModel,
  CollectionModel,
  DiscussionModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import shareCollectionAsDiscussion from "./shareCollectionAsDiscussion.js";

let originalMockAuth: string | undefined;

class CollectionModelStub {
  constructor(private readonly records: Array<Record<string, unknown>>) {}
  findCalls: Array<Record<string, unknown>> = [];

  async find(args: Record<string, unknown>) {
    this.findCalls.push(args);
    return this.records;
  }
}

class ChannelModelStub {
  constructor(private readonly records: Array<Record<string, unknown>>) {}
  findCalls: Array<Record<string, unknown>> = [];

  async find(args: Record<string, unknown>) {
    this.findCalls.push(args);
    return this.records;
  }
}

const buildContext = (username = "alice") =>
  ({
    req: {
      headers: {
        authorization: `Bearer ${jwt.sign(
          {
            email: `${username}@example.com`,
            username,
          },
          "test-secret"
        )}`,
      },
    },
    ogm: {
      model: (name: string) => {
        if (name === "User") {
          return {
            find: async () => [{ username, ModerationProfile: null }],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  }) as unknown as GraphQLContext;

const publicCollection = {
  id: "collection-1",
  name: "Builds I love",
  visibility: "PUBLIC",
  CreatedBy: { username: "alice" },
};

const buildResolver = ({
  collectionRecords = [publicCollection],
  channelRecords = [{ uniqueName: "sims4_builds" }],
  permissionResult = true,
  createDiscussions,
}: {
  collectionRecords?: Array<Record<string, unknown>>;
  channelRecords?: Array<Record<string, unknown>>;
  permissionResult?: true | Error;
  createDiscussions?: NonNullable<
    Parameters<typeof shareCollectionAsDiscussion>[0]["createDiscussions"]
  >;
} = {}) => {
  const Collection = new CollectionModelStub(collectionRecords);
  const Channel = new ChannelModelStub(channelRecords);
  const calls = {
    permissions: [] as unknown[],
    createDiscussions: [] as unknown[],
  };
  const create =
    createDiscussions ??
    (async (...args: unknown[]) => {
      calls.createDiscussions.push(args);
      return [{ id: "discussion-1", title: "Shared builds" }];
    });

  const resolver = shareCollectionAsDiscussion({
    Discussion: {} as DiscussionModel,
    Collection: Collection as unknown as CollectionModel,
    Channel: Channel as unknown as ChannelModel,
    driver: {} as Driver,
    checkChannelPermissions: async (args) => {
      calls.permissions.push(args);
      return permissionResult;
    },
    createDiscussions: create,
  });

  return { resolver, calls, Collection, Channel };
};

beforeEach(() => {
  originalMockAuth = process.env.E2E_MOCK_AUTH;
  process.env.E2E_MOCK_AUTH = "true";
});

afterEach(() => {
  if (originalMockAuth === undefined) {
    delete process.env.E2E_MOCK_AUTH;
  } else {
    process.env.E2E_MOCK_AUTH = originalMockAuth;
  }
});

test("shareCollectionAsDiscussion creates a discussion linked to a public owned collection", async () => {
  const { resolver, calls } = buildResolver();

  const result = await resolver(
    null,
    {
      collectionId: "collection-1",
      serverId: "sims4_builds",
      title: "Shared builds",
      shareMessage: "Some favorites from my library",
    },
    buildContext(),
    {} as never
  );

  assert.deepEqual(result, { id: "discussion-1", title: "Shared builds" });
  assert.equal(calls.permissions.length, 1);
  assert.deepEqual((calls.permissions[0] as any).channelConnections, [
    "sims4_builds",
  ]);
  assert.equal((calls.permissions[0] as any).permissionCheck, "canCreateDiscussion");

  const createInput = (calls.createDiscussions[0] as any)[2][0];
  assert.deepEqual(createInput.channelConnections, ["sims4_builds"]);
  assert.equal(createInput.discussionCreateInput.title, "Shared builds");
  assert.equal(createInput.discussionCreateInput.body, "Some favorites from my library");
  assert.deepEqual(
    createInput.discussionCreateInput.SharedCollection.connect.where.node,
    { id: "collection-1" }
  );
  assert.deepEqual(createInput.discussionCreateInput.Author.connect.where.node, {
    username: "alice",
  });
});

test("shareCollectionAsDiscussion rejects private collections", async () => {
  const { resolver } = buildResolver({
    collectionRecords: [
      {
        ...publicCollection,
        visibility: "PRIVATE",
      },
    ],
  });

  await assert.rejects(
    resolver(
      null,
      {
        collectionId: "collection-1",
        serverId: "sims4_builds",
        title: "Shared builds",
      },
      buildContext(),
      {} as never
    ),
    /Only public collections can be shared/
  );
});

test("shareCollectionAsDiscussion rejects non-owners", async () => {
  const { resolver } = buildResolver({
    collectionRecords: [],
  });

  await assert.rejects(
    resolver(
      null,
      {
        collectionId: "collection-1",
        serverId: "sims4_builds",
        title: "Shared builds",
      },
      buildContext(),
      {} as never
    ),
    /Collection not found/
  );
});

test("shareCollectionAsDiscussion rejects missing forum posting permission", async () => {
  const { resolver } = buildResolver({
    permissionResult: new Error("You do not have permission to post there."),
  });

  await assert.rejects(
    resolver(
      null,
      {
        collectionId: "collection-1",
        serverId: "sims4_builds",
        title: "Shared builds",
      },
      buildContext(),
      {} as never
    ),
    /permission to post/
  );
});

test("shareCollectionAsDiscussion rejects unknown target forums", async () => {
  const { resolver } = buildResolver({
    channelRecords: [],
  });

  await assert.rejects(
    resolver(
      null,
      {
        collectionId: "collection-1",
        serverId: "missing_forum",
        title: "Shared builds",
      },
      buildContext(),
      {} as never
    ),
    /Forum not found/
  );
});
