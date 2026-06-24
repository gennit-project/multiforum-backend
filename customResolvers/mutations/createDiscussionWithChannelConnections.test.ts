import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import type { DiscussionModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { createDiscussionsFromInput } from "./createDiscussionWithChannelConnections.js";

// Store original env value
let originalMockAuth: string | undefined;

type FindArgs = {
  where?: Record<string, unknown>;
  selectionSet?: string;
};

type CreateArgs = {
  input: Array<Record<string, unknown>>;
  selectionSet?: string;
};

class DiscussionModelStub {
  findCalls: FindArgs[] = [];
  createCalls: CreateArgs[] = [];
  createdDiscussions: Array<{ id: string; title: string; Author: { username: string } }> = [];
  nextId = 1;

  async find(args: FindArgs) {
    this.findCalls.push(args);
    const id = (args.where as any)?.id;
    const found = this.createdDiscussions.find(d => d.id === id);
    return found ? [found] : [];
  }

  async create(args: CreateArgs) {
    this.createCalls.push(args);
    const input = args.input[0];
    const discussion = {
      id: `discussion-${this.nextId++}`,
      title: (input as any).title || "Test Discussion",
      body: (input as any).body || "",
      Author: { username: "testuser" },
      DiscussionChannels: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      Tags: [],
    };
    this.createdDiscussions.push(discussion);
    return { discussions: [discussion] };
  }
}

class SessionStub {
  runCalls: Array<{ query: string; params: Record<string, unknown> }> = [];
  shouldFailConstraint = false;

  async run(query: string, params: Record<string, unknown>) {
    this.runCalls.push({ query, params });
    if (this.shouldFailConstraint) {
      throw new Error("Constraint validation failed");
    }
    return { records: [] };
  }

  async close() {}
}

const createDriver = (session: SessionStub) => ({
  session: () => session,
} as unknown as Driver);

const createContext = (username: string = "testuser") => ({
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
} as unknown as GraphQLContext);

test("createDiscussionWithChannelConnections", async (t) => {
  // Enable mock auth for tests that use JWT context
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

  await t.test("creates a discussion with channel connections", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    const result = await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: {
            title: "Test Discussion",
            body: "Test body content",
          },
          channelConnections: ["test-channel"],
        },
      ]
    );

    assert.equal(result.length, 1);
    assert.equal(discussionModel.createCalls.length, 1);
    assert.equal(session.runCalls.length, 1);
    assert.equal(session.runCalls[0].params.channelUniqueName, "test-channel");
  });

  await t.test("creates discussion with multiple channel connections", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    const result = await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: {
            title: "Multi-channel Discussion",
            body: "Test body",
          },
          channelConnections: ["channel-1", "channel-2", "channel-3"],
        },
      ]
    );

    assert.equal(result.length, 1);
    assert.equal(session.runCalls.length, 3);
    assert.equal(session.runCalls[0].params.channelUniqueName, "channel-1");
    assert.equal(session.runCalls[1].params.channelUniqueName, "channel-2");
    assert.equal(session.runCalls[2].params.channelUniqueName, "channel-3");
  });

  await t.test("throws error when input is empty", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    await assert.rejects(
      async () => {
        await createDiscussionsFromInput(discussionModel as unknown as DiscussionModel, driver, []);
      },
      {
        message: "Input cannot be empty",
      }
    );
  });

  await t.test("throws error when no channels are provided", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    await assert.rejects(
      async () => {
        await createDiscussionsFromInput(
          discussionModel as unknown as DiscussionModel,
          driver,
          [
            {
              discussionCreateInput: {
                title: "No Channels",
                body: "Test",
              },
              channelConnections: [],
            },
          ]
        );
      },
      {
        message: "Failed to create discussions: At least one channel must be selected",
      }
    );
  });

  await t.test("handles duplicate channel constraint gracefully", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    session.shouldFailConstraint = true;
    const driver = createDriver(session);

    // Should not throw, should skip the duplicate
    const result = await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: {
            title: "Duplicate Channel Test",
            body: "Test",
          },
          channelConnections: ["duplicate-channel"],
        },
      ]
    );

    assert.equal(result.length, 1);
    assert.equal(session.runCalls.length, 1);
  });

  await t.test("creates tags with connect-or-create pattern", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: {
            title: "Tagged Discussion",
            body: "Test body",
            Tags: {
              connectOrCreate: [
                {
                  where: { node: { text: "tag1" } },
                  onCreate: { node: { text: "tag1" } },
                },
                {
                  where: { node: { text: "tag2" } },
                  onCreate: { node: { text: "tag2" } },
                },
              ],
            },
          },
          channelConnections: ["test-channel"],
        },
      ]
    );

    assert.equal(discussionModel.createCalls.length, 1);
    const createInput = discussionModel.createCalls[0].input[0] as any;
    assert.ok(createInput.Tags);
    assert.ok(createInput.Tags.connectOrCreate);
    assert.equal(createInput.Tags.connectOrCreate.length, 2);
  });

  await t.test("sanitizes album creation when context is provided", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);
    const context = createContext("albumuser");

    await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: {
            title: "Discussion with Album",
            body: "Test",
            Album: {
              create: {
                node: {
                  // The sanitizer should add Owner connection
                },
              },
            },
          } as any,
          channelConnections: ["test-channel"],
        },
      ],
      context
    );

    assert.equal(discussionModel.createCalls.length, 1);
  });

  await t.test("throws when album creation attempted without context", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    await assert.rejects(
      async () => {
        await createDiscussionsFromInput(
          discussionModel as unknown as DiscussionModel,
          driver,
          [
            {
              discussionCreateInput: {
                title: "Discussion with Album",
                body: "Test",
                Album: {
                  create: {
                    node: {},
                  },
                },
              } as any,
              channelConnections: ["test-channel"],
            },
          ]
          // No context provided
        );
      },
      {
        message: "Context is required for album creation.",
      }
    );
  });

  await t.test("creates multiple discussions in a single call", async () => {
    const discussionModel = new DiscussionModelStub();
    const session = new SessionStub();
    const driver = createDriver(session);

    const result = await createDiscussionsFromInput(
      discussionModel as unknown as DiscussionModel,
      driver,
      [
        {
          discussionCreateInput: { title: "Discussion 1", body: "Body 1" },
          channelConnections: ["channel-a"],
        },
        {
          discussionCreateInput: { title: "Discussion 2", body: "Body 2" },
          channelConnections: ["channel-b"],
        },
      ]
    );

    assert.equal(result.length, 2);
    assert.equal(discussionModel.createCalls.length, 2);
    assert.equal(session.runCalls.length, 2);
  });
});
