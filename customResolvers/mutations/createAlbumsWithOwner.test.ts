import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import createAlbumsWithOwnerResolver from "./createAlbumsWithOwner.js";

// Enable mock auth for tests
process.env.PLAYWRIGHT_MOCK_AUTH = "true";

const mockInfo = null as unknown as GraphQLResolveInfo;

class ModelStub {
  findCalls: any[] = [];
  createCalls: any[] = [];

  constructor(
    private findImpl: (args: any) => any[] = () => [],
    private createImpl: (args: any) => any = () => ({ albums: [] })
  ) {}

  async find(args: any) {
    this.findCalls.push(args);
    return this.findImpl(args);
  }

  async create(args: any) {
    this.createCalls.push(args);
    return this.createImpl(args);
  }
}

const createUserOgmModel = (username: string | null) =>
  new ModelStub(({ where }) => {
    if (where?.username === username) {
      return [
        {
          username,
          ModerationProfile: {
            displayName: `mod-${username}`,
          },
        },
      ];
    }
    return [];
  });

const createMockContext = (username: string | null = null) => ({
  req: {
    headers: username
      ? {
          authorization: `Bearer ${jwt.sign(
            { email: `${username}@example.com`, username },
            "test-secret"
          )}`,
        }
      : {},
  },
  ogm: {
    model: (name: string) => {
      if (name === "User") {
        return createUserOgmModel(username);
      }
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
} as unknown as GraphQLContext);

// Logged-out rejection tests
test("createAlbumsWithOwner rejects when user is not logged in", async () => {
  const Album = new ModelStub();
  const User = new ModelStub();

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: [{ imageOrder: [] }] },
        createMockContext(null),
        mockInfo
      ),
    {
      message: "You must be logged in to create albums.",
    }
  );

  assert.equal(User.findCalls.length, 0, "Should not query User when logged out");
  assert.equal(Album.createCalls.length, 0, "Should not create Album when logged out");
});

// Missing user rejection tests
test("createAlbumsWithOwner rejects when user not found in database", async () => {
  const Album = new ModelStub();
  const User = new ModelStub(() => []); // Returns empty array = user not found

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: [{ imageOrder: [] }] },
        createMockContext("ghost-user"),
        mockInfo
      ),
    {
      message: "Could not find the album owner.",
    }
  );

  assert.equal(User.findCalls.length, 1);
  assert.equal(User.findCalls[0].where.username, "ghost-user");
  assert.equal(Album.createCalls.length, 0, "Should not create Album when user not found");
});

// Forced Owner replacement tests
test("createAlbumsWithOwner replaces client-provided Owner with server username", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({
      albums: [
        {
          id: "album-1",
          imageOrder: [],
          Owner: { username: "real-user" },
          Images: [],
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "real-user" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: [
        {
          imageOrder: ["img1"],
          // Malicious attempt to set a different owner
          Owner: {
            connect: {
              where: {
                node: {
                  username: "victim-user",
                },
              },
            },
          },
        },
      ],
    },
    createMockContext("real-user"),
    mockInfo
  );

  assert.equal(Album.createCalls.length, 1);
  const createInput = Album.createCalls[0].input[0];

  // Owner should be replaced with logged-in user, not the client-provided one
  assert.deepEqual(createInput.Owner, {
    connect: {
      where: {
        node: {
          username: "real-user",
        },
      },
    },
  });
});

test("createAlbumsWithOwner sets Owner when client omits it", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({
      albums: [
        {
          id: "album-1",
          imageOrder: [],
          Owner: { username: "alice" },
          Images: [],
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "alice" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: [
        {
          imageOrder: ["img1", "img2"],
          // No Owner provided
        },
      ],
    },
    createMockContext("alice"),
    mockInfo
  );

  const createInput = Album.createCalls[0].input[0];

  assert.deepEqual(createInput.Owner, {
    connect: {
      where: {
        node: {
          username: "alice",
        },
      },
    },
  });
});

// Nested image create sanitization tests
test("createAlbumsWithOwner sanitizes nested Images.create Uploader", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({
      albums: [
        {
          id: "album-1",
          imageOrder: ["img1"],
          Owner: { username: "bob" },
          Images: [{ id: "img1", url: "https://example.com/1.jpg" }],
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "bob" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: [
        {
          imageOrder: ["img1"],
          Images: {
            create: [
              {
                node: {
                  url: "https://example.com/1.jpg",
                  alt: "Test image",
                  // Malicious attempt to set different uploader
                  Uploader: {
                    connect: {
                      where: {
                        node: {
                          username: "impersonated-user",
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
    createMockContext("bob"),
    mockInfo
  );

  const createInput = Album.createCalls[0].input[0];
  const imageCreate = createInput.Images.create[0];

  // Uploader should be replaced with logged-in user
  assert.deepEqual(imageCreate.node.Uploader, {
    connect: {
      where: {
        node: {
          username: "bob",
        },
      },
    },
  });
  // Other properties should be preserved
  assert.equal(imageCreate.node.url, "https://example.com/1.jpg");
  assert.equal(imageCreate.node.alt, "Test image");
});

test("createAlbumsWithOwner sanitizes multiple nested images", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({
      albums: [{ id: "album-1", imageOrder: [], Owner: { username: "user" }, Images: [] }],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: [
        {
          imageOrder: [],
          Images: {
            create: [
              {
                node: {
                  url: "https://example.com/1.jpg",
                  Uploader: { connect: { where: { node: { username: "attacker1" } } } },
                },
              },
              {
                node: {
                  url: "https://example.com/2.jpg",
                  Uploader: { connect: { where: { node: { username: "attacker2" } } } },
                },
              },
            ],
          },
        },
      ],
    },
    createMockContext("user"),
    mockInfo
  );

  const createInput = Album.createCalls[0].input[0];

  assert.equal(createInput.Images.create.length, 2);
  assert.equal(createInput.Images.create[0].node.Uploader.connect.where.node.username, "user");
  assert.equal(createInput.Images.create[1].node.Uploader.connect.where.node.username, "user");
});

// Multiple albums test
test("createAlbumsWithOwner sanitizes multiple albums in a single request", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({
      albums: [
        { id: "album-1", imageOrder: [], Owner: { username: "user" }, Images: [] },
        { id: "album-2", imageOrder: [], Owner: { username: "user" }, Images: [] },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: [
        {
          imageOrder: ["a"],
          Owner: { connect: { where: { node: { username: "wrong1" } } } },
        },
        {
          imageOrder: ["b"],
          Owner: { connect: { where: { node: { username: "wrong2" } } } },
        },
      ],
    },
    createMockContext("user"),
    mockInfo
  );

  const inputs = Album.createCalls[0].input;

  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].Owner.connect.where.node.username, "user");
  assert.equal(inputs[1].Owner.connect.where.node.username, "user");
});

// Response structure test
test("createAlbumsWithOwner returns the created albums", async () => {
  const expectedResponse = {
    albums: [
      {
        id: "album-123",
        imageOrder: ["img1"],
        Owner: { username: "creator" },
        Images: [{ id: "img1", url: "https://example.com/image.jpg" }],
        Discussions: [],
      },
    ],
  };

  const Album = new ModelStub(
    () => [],
    () => expectedResponse
  );
  const User = new ModelStub(() => [{ username: "creator" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  const result = await resolver(
    null,
    { input: [{ imageOrder: ["img1"] }] },
    createMockContext("creator"),
    mockInfo
  );

  assert.deepEqual(result, expectedResponse);
});

// Error handling test
test("createAlbumsWithOwner wraps Album.create errors", async () => {
  const Album = new ModelStub(
    () => [],
    () => {
      throw new Error("Database constraint violation");
    }
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: [{ imageOrder: [] }] },
        createMockContext("user"),
        mockInfo
      ),
    {
      message: /Failed to create albums.*Database constraint violation/,
    }
  );
});

// Empty input handling
test("createAlbumsWithOwner handles empty input array", async () => {
  const Album = new ModelStub(
    () => [],
    () => ({ albums: [] })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createAlbumsWithOwnerResolver({
    Album: Album as any,
    User: User as any,
  });

  const result = await resolver(
    null,
    { input: [] },
    createMockContext("user"),
    mockInfo
  );

  assert.deepEqual(result, { albums: [] });
  assert.deepEqual(Album.createCalls[0].input, []);
});
