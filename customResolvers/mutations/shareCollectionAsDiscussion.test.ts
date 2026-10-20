import type { CollectionShareSnapshot } from "../../services/persistence/collectionReadRepository.js";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import type {
  DiscussionModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { GraphQLError } from "graphql";
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
    collectionReadRepository: {
      findProfileCollections: async () => [],
      findPublicContaining: async () => [],
      findOwnedShareTarget: async (id, username) => Collection.find({ where: { id, CreatedBy: { username } } }) as Promise<CollectionShareSnapshot[]>,
      findShareChannel: async uniqueName => Channel.find({ where: { uniqueName } }) as Promise<Array<{uniqueName: string}>>,
    },
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
      flairIds: ["showcase"],
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
  assert.deepEqual(createInput.channelFlairSelections, [
    {
      channelUniqueName: "sims4_builds",
      flairIds: ["showcase"],
    },
  ]);
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

test("shareCollectionAsDiscussion preserves flair validation error metadata", async () => {
  const flairError = new GraphQLError("A flair is required.", {
    extensions: {
      code: "DISCUSSION_FLAIR_REQUIRED",
      channelUniqueName: "sims4_builds",
    },
  });
  const { resolver } = buildResolver({
    createDiscussions: async () => {
      throw flairError;
    },
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
    (error: unknown) => error === flairError
  );
});

test("collection/channel reads stay outside creation error wrapping and precede permission/create", async () => {
  const state = buildResolver();
  const failure = new Error("snapshot failed");
  state.Collection.find = async () => { throw failure; };
  await assert.rejects(state.resolver(null, { collectionId:'collection-1',serverId:'cats',title:'Share' },buildContext(),{} as never), error=>error===failure);
  assert.deepEqual(state.calls.permissions,[]);
  assert.deepEqual(state.calls.createDiscussions,[]);
  assert.deepEqual(state.Channel.findCalls,[]);

  const channelFailure = buildResolver();
  channelFailure.Channel.find = async () => { throw failure; };
  await assert.rejects(channelFailure.resolver(null, { collectionId:'collection-1',serverId:'cats',title:'Share' },buildContext(),{} as never),error=>error===failure);
  assert.equal(channelFailure.Collection.findCalls.length,1);
  assert.deepEqual(channelFailure.calls.permissions,[]);
  assert.deepEqual(channelFailure.calls.createDiscussions,[]);
});

test("sharing retains trimmed lookup identities and creation adapter inputs", async () => {
  const state = buildResolver();
  await state.resolver(null,{collectionId:' collection-1 ',serverId:' sims4_builds ',title:' Shared ',content:' Content ',shareMessage:' '},buildContext(),{} as never);
  assert.deepEqual(state.Collection.findCalls,[{where:{id:'collection-1',CreatedBy:{username:'alice'}}}]);
  assert.deepEqual(state.Channel.findCalls,[{where:{uniqueName:'sims4_builds'}}]);
  const input=(state.calls.createDiscussions[0] as any)[2][0];
  assert.equal(input.discussionCreateInput.title,'Shared');
  assert.equal(input.discussionCreateInput.body,'Content');
});
