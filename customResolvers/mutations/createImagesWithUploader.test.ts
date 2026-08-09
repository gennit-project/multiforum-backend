import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import createImagesWithUploader from "./createImagesWithUploader.js";
import type { GraphQLContext } from "../../types/context.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

class UserModelStub {
  async find() {
    return [{ username: "alice" }];
  }
}

class ImageModelStub {
  createCalls: any[] = [];

  constructor(private readonly createImpl: (args: any) => any) {}

  async create(args: any) {
    this.createCalls.push(args);
    return this.createImpl(args);
  }
}

const buildDriver = (recordData?: Record<string, unknown>) => {
  const calls = {
    sessions: [] as string[],
    run: [] as Array<{ query: string; params: Record<string, unknown> }>,
    close: 0,
  };

  const driver = {
    session: ({ defaultAccessMode }: { defaultAccessMode: string }) => {
      calls.sessions.push(defaultAccessMode);
      return {
        run: async (query: string, params: Record<string, unknown>) => {
          calls.run.push({ query, params });
          return {
            records: recordData
              ? [
                  {
                    get: (key: string) => recordData[key],
                  },
                ]
              : [],
          };
        },
        close: async () => {
          calls.close += 1;
        },
      };
    },
  };

  return { driver: driver as unknown as Driver, calls };
};

const createMockContext = (username: string) =>
  ({
    req: {
      headers: {
        authorization: `Bearer ${jwt.sign(
          { email: `${username}@example.com`, username },
          "test-secret"
        )}`,
      },
    },
    ogm: {
      model: (name: string) => {
        if (name === "User") {
          return {
            find: async () => [
              {
                ModerationProfile: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  }) as unknown as GraphQLContext;

test("createImages persists generated variant URLs alongside verified upload metadata", async () => {
  const { driver, calls } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/pic.png",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
    uploadedAt: "2026-08-09T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
  const Image = new ImageModelStub((args) => ({
    images: [
      {
        id: "image-1",
        ...args.input[0],
      },
    ],
  }));
  const resolver = createImagesWithUploader({
    Image: Image as any,
    User: new UserModelStub() as any,
    driver,
    generateVariants: async () => ({
      originalWidth: 400,
      originalHeight: 200,
      variantUrls: {
        list80: "https://storage.googleapis.com/bucket/uploads/alice/pic__list80.webp",
        list160:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__list160.webp",
        list320:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__list320.webp",
        detail640:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail640.webp",
        detail960:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail960.webp",
        detail1280:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail1280.webp",
      },
      variantStorageObjectNames: {
        list80: "uploads/alice/pic__list80.webp",
        list160: "uploads/alice/pic__list160.webp",
        list320: "uploads/alice/pic__list320.webp",
        detail640: "uploads/alice/pic__detail640.webp",
        detail960: "uploads/alice/pic__detail960.webp",
        detail1280: "uploads/alice/pic__detail1280.webp",
      },
    }),
  });

  const result = await resolver(
    null,
    {
      input: [
        {
          url: "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
          storageObjectName: "uploads/alice/pic.png",
          alt: "hello",
        } as any,
      ],
    },
    createMockContext("alice"),
    {} as any
  );

  assert.deepEqual(
    {
      imageMetadata: Image.createCalls[0].input[0],
      claimedByType: calls.run[1].params.claimedByType,
      claimedById: calls.run[1].params.claimedById,
      resultId: result.images[0].id,
    },
    {
      imageMetadata: {
        url: "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
        storageObjectName: "uploads/alice/pic.png",
        alt: "hello",
        storageBucket: "bucket",
        storageUrl:
          "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
        width: 400,
        height: 200,
        uploadedAt: "2026-08-09T12:00:00.000000000Z",
        uploadedByUsername: "alice",
        uploadedByIp: "203.0.113.10",
        variantUrls: {
          list80:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__list80.webp",
          list160:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__list160.webp",
          list320:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__list320.webp",
          detail640:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__detail640.webp",
          detail960:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__detail960.webp",
          detail1280:
            "https://storage.googleapis.com/bucket/uploads/alice/pic__detail1280.webp",
        },
        list80Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__list80.webp",
        list160Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__list160.webp",
        list320Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__list320.webp",
        detail640Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail640.webp",
        detail960Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail960.webp",
        detail1280Url:
          "https://storage.googleapis.com/bucket/uploads/alice/pic__detail1280.webp",
        Uploader: {
          connect: {
            where: {
              node: {
                username: "alice",
              },
            },
          },
        },
      },
      claimedByType: "Image",
      claimedById: "image-1",
      resultId: "image-1",
    }
  );
});

test("createImages still creates the image when variant generation fails", async () => {
  const { driver } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/pic.png",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
    uploadedAt: "2026-08-09T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
  const Image = new ImageModelStub((args) => ({
    images: [
      {
        id: "image-1",
        ...args.input[0],
      },
    ],
  }));
  const resolver = createImagesWithUploader({
    Image: Image as any,
    User: new UserModelStub() as any,
    driver,
    generateVariants: async () => {
      throw new Error("resize failed");
    },
  });

  const result = await resolver(
    null,
    {
      input: [
        {
          url: "https://storage.googleapis.com/bucket/uploads/alice/pic.png",
          storageObjectName: "uploads/alice/pic.png",
        } as any,
      ],
    },
    createMockContext("alice"),
    {} as any
  );

  assert.equal(result.images[0].id, "image-1");
  assert.deepEqual(
    {
      variantUrls: Image.createCalls[0].input[0].variantUrls,
      list80Url: Image.createCalls[0].input[0].list80Url,
      storageObjectName: Image.createCalls[0].input[0].storageObjectName,
    },
    {
      variantUrls: undefined,
      list80Url: undefined,
      storageObjectName: "uploads/alice/pic.png",
    }
  );
});
