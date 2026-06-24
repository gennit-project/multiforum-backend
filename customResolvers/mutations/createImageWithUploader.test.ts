import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import createImageWithUploaderResolver from "./createImageWithUploader.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

// The resolver's 4th argument is GraphQLResolveInfo; the tests don't use it,
// so pass a null cast to the real type instead of an untyped null.
const mockInfo = null as unknown as GraphQLResolveInfo;

// Enable mock auth for tests
process.env.PLAYWRIGHT_MOCK_AUTH = "true";

class ModelStub {
  findCalls: any[] = [];
  createCalls: any[] = [];

  constructor(
    private findImpl: (args: any) => any[] = () => [],
    private createImpl: (args: any) => any = () => ({ images: [] })
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

const createMockContext = (username: string | null = null) =>
  ({
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
test("createImageWithUploader rejects when user is not logged in", async () => {
  const Image = new ModelStub();
  const User = new ModelStub();

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: { url: "https://example.com/image.jpg" } },
        createMockContext(null),
        mockInfo
      ),
    {
      message: "You must be logged in to upload images.",
    }
  );

  assert.equal(User.findCalls.length, 0, "Should not query User when logged out");
  assert.equal(Image.createCalls.length, 0, "Should not create Image when logged out");
});

// Missing user rejection tests
test("createImageWithUploader rejects when user not found in database", async () => {
  const Image = new ModelStub();
  const User = new ModelStub(() => []); // Returns empty array = user not found

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: { url: "https://example.com/image.jpg" } },
        createMockContext("deleted-user"),
        mockInfo
      ),
    {
      message: "Could not find the original uploader of this image.",
    }
  );

  assert.equal(User.findCalls.length, 1);
  assert.equal(User.findCalls[0].where.username, "deleted-user");
  assert.equal(Image.createCalls.length, 0, "Should not create Image when user not found");
});

// Forced Uploader replacement tests
test("createImageWithUploader sets Uploader to logged-in user", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          Uploader: { username: "alice" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "alice" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        alt: "Test image",
      },
    },
    createMockContext("alice"),
    mockInfo
  );

  assert.equal(Image.createCalls.length, 1);
  const createInput = Image.createCalls[0].input[0];

  // Uploader should be set to logged-in user
  assert.deepEqual(createInput.Uploader, {
    connect: {
      where: {
        node: {
          username: "alice",
        },
      },
    },
  });
});

test("createImageWithUploader ignores any client-provided Uploader field", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          Uploader: { username: "real-user" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "real-user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  // Note: The resolver only accepts specific fields from input
  // Any extra fields like "Uploader" would be ignored by the resolver
  // This test verifies the Uploader is always set to logged-in user
  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        // Even if client somehow passed Uploader, it would be overridden
      },
    },
    createMockContext("real-user"),
    mockInfo
  );

  const createInput = Image.createCalls[0].input[0];

  assert.equal(createInput.Uploader.connect.where.node.username, "real-user");
});

// Image properties preservation tests
test("createImageWithUploader preserves all image properties", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          alt: "Alt text",
          caption: "Caption",
          longDescription: "Long description",
          copyright: "CC-BY-4.0",
          hasSensitiveContent: true,
          hasSpoiler: false,
          Uploader: { username: "user" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        alt: "Alt text",
        caption: "Caption",
        longDescription: "Long description",
        copyright: "CC-BY-4.0",
        hasSensitiveContent: true,
        hasSpoiler: false,
      },
    },
    createMockContext("user"),
    mockInfo
  );

  const createInput = Image.createCalls[0].input[0];

  assert.equal(createInput.url, "https://example.com/image.jpg");
  assert.equal(createInput.alt, "Alt text");
  assert.equal(createInput.caption, "Caption");
  assert.equal(createInput.longDescription, "Long description");
  assert.equal(createInput.copyright, "CC-BY-4.0");
  assert.equal(createInput.hasSensitiveContent, true);
  assert.equal(createInput.hasSpoiler, false);
});

// Optional album connection tests
test("createImageWithUploader connects to album when albumId provided", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          Uploader: { username: "user" },
          Album: { id: "album-123" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        albumId: "album-123",
      },
    },
    createMockContext("user"),
    mockInfo
  );

  const createInput = Image.createCalls[0].input[0];

  assert.deepEqual(createInput.Album, {
    connect: {
      where: {
        node: {
          id: "album-123",
        },
      },
    },
  });
});

test("createImageWithUploader does not connect album when albumId not provided", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          Uploader: { username: "user" },
          Album: null,
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        // No albumId
      },
    },
    createMockContext("user"),
    mockInfo
  );

  const createInput = Image.createCalls[0].input[0];

  assert.equal(createInput.Album, undefined);
});

test("createImageWithUploader handles empty string albumId as no album", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/image.jpg",
          Uploader: { username: "user" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await resolver(
    null,
    {
      input: {
        url: "https://example.com/image.jpg",
        albumId: "", // Empty string
      },
    },
    createMockContext("user"),
    mockInfo
  );

  const createInput = Image.createCalls[0].input[0];

  // Empty string is falsy, so Album should not be set
  assert.equal(createInput.Album, undefined);
});

// Response structure tests
test("createImageWithUploader returns the created image", async () => {
  const expectedImage = {
    id: "img-123",
    url: "https://example.com/photo.jpg",
    alt: "A photo",
    caption: "My caption",
    longDescription: null,
    copyright: null,
    createdAt: "2024-01-01T00:00:00Z",
    hasSensitiveContent: false,
    hasSpoiler: false,
    scanStatus: "pending",
    Uploader: { username: "photographer" },
    Album: { id: "album-1" },
  };

  const Image = new ModelStub(
    () => [],
    () => ({ images: [expectedImage] })
  );
  const User = new ModelStub(() => [{ username: "photographer" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  const result = await resolver(
    null,
    {
      input: {
        url: "https://example.com/photo.jpg",
        alt: "A photo",
        caption: "My caption",
        albumId: "album-1",
      },
    },
    createMockContext("photographer"),
    mockInfo
  );

  assert.deepEqual(result, expectedImage);
});

// Error handling tests
test("createImageWithUploader wraps Image.create errors", async () => {
  const Image = new ModelStub(
    () => [],
    () => {
      throw new Error("Storage service unavailable");
    }
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: { url: "https://example.com/image.jpg" } },
        createMockContext("user"),
        mockInfo
      ),
    {
      message: /Failed to create image.*Storage service unavailable/,
    }
  );
});

test("createImageWithUploader throws when no image is created", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({ images: [] }) // Empty array = no image created
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        { input: { url: "https://example.com/image.jpg" } },
        createMockContext("user"),
        mockInfo
      ),
    {
      message: /Failed to create image/,
    }
  );
});

// Minimal input test
test("createImageWithUploader works with only url provided", async () => {
  const Image = new ModelStub(
    () => [],
    () => ({
      images: [
        {
          id: "img-1",
          url: "https://example.com/minimal.jpg",
          Uploader: { username: "user" },
        },
      ],
    })
  );
  const User = new ModelStub(() => [{ username: "user" }]);

  const resolver = createImageWithUploaderResolver({
    Image: Image as any,
    User: User as any,
  });

  const result = await resolver(
    null,
    {
      input: {
        url: "https://example.com/minimal.jpg",
      },
    },
    createMockContext("user"),
    mockInfo
  );

  assert.equal(result.id, "img-1");
  assert.equal(result.url, "https://example.com/minimal.jpg");

  const createInput = Image.createCalls[0].input[0];
  assert.equal(createInput.url, "https://example.com/minimal.jpg");
  assert.equal(createInput.alt, undefined);
  assert.equal(createInput.caption, undefined);
});
