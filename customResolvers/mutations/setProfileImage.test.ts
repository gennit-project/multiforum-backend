import { before, after, afterEach } from "node:test";
import { denyImageExternalIo } from "../../tests/denyImageExternalIo.js";
let ioGuard: ReturnType<typeof denyImageExternalIo>;
before(() => { ioGuard = denyImageExternalIo(); });
afterEach(() => ioGuard.assertUnused());
after(() => ioGuard.restore());
import { PROFILE_IMAGE_SELECTION } from "../../services/persistence/imageWriteRepository.js";
import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import setProfileImage from "./setProfileImage.js";
import type { GraphQLContext } from "../../types/context.js";

process.env.PLAYWRIGHT_MOCK_AUTH = "true";

class UserModelStub {
  updateCalls: any[] = [];

  constructor(private readonly updateImpl: (args: any) => any) {}

  async update(args: any) {
    this.updateCalls.push(args);
    return this.updateImpl(args);
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

test("setProfileImage persists avatar variants for a verified uploaded profile image", async () => {
  const { driver, calls } = buildDriver({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/avatar.png",
    storageUrl: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
    uploadedAt: "2026-08-09T12:00:00.000000000Z",
    uploadedByUsername: "alice",
    uploadedByIp: "203.0.113.10",
  });
  const User = new UserModelStub((args) => ({
    users: [
      {
        username: "alice",
        ...args.update,
      },
    ],
  }));
  const resolver = setProfileImage({
    repository: {setProfileImage: async (username, update) => User.update({where:{username},update,selectionSet:`{ users ${PROFILE_IMAGE_SELECTION} }`})},
    driver,
    generateVariants: async () => ({
      variantUrls: {
        avatar32:
          "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar32.webp",
        avatar48:
          "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar48.webp",
        avatar64:
          "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar64.webp",
        avatar96:
          "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar96.webp",
      },
      variantStorageObjectNames: {
        avatar32: "uploads/alice/avatar__avatar32.webp",
        avatar48: "uploads/alice/avatar__avatar48.webp",
        avatar64: "uploads/alice/avatar__avatar64.webp",
        avatar96: "uploads/alice/avatar__avatar96.webp",
      },
    }),
  });

  const result = await resolver(
    null,
    {
      username: "alice",
      imageUrl: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
    },
    createMockContext("alice")
  );

  assert.deepEqual(
    {
      updateInput: User.updateCalls[0],
      claimedByType: calls.run[1].params.claimedByType,
      claimedById: calls.run[1].params.claimedById,
      result,
    },
    {
      updateInput: {
        where: { username: "alice" },
        update: {
          profilePicURL: {
            set: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
          },
          variantUrls: {
            set: {
              avatar32:
                "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar32.webp",
              avatar48:
                "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar48.webp",
              avatar64:
                "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar64.webp",
              avatar96:
                "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar96.webp",
            },
          },
          avatar32Url: {
            set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar32.webp",
          },
          avatar48Url: {
            set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar48.webp",
          },
          avatar64Url: {
            set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar64.webp",
          },
          avatar96Url: {
            set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar96.webp",
          },
        },
        selectionSet: `{ users ${PROFILE_IMAGE_SELECTION} }`,
      },
      claimedByType: "UserProfileImage",
      claimedById: "alice",
      // The stub returns `{ username, ...update }`, so the v7 `{ set }`
      // wrappers flow straight through into the stubbed user payload.
      result: {
        username: "alice",
        profilePicURL: {
          set: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
        },
        variantUrls: {
          set: {
            avatar32:
              "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar32.webp",
            avatar48:
              "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar48.webp",
            avatar64:
              "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar64.webp",
            avatar96:
              "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar96.webp",
          },
        },
        avatar32Url: {
          set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar32.webp",
        },
        avatar48Url: {
          set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar48.webp",
        },
        avatar64Url: {
          set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar64.webp",
        },
        avatar96Url: {
          set: "https://storage.googleapis.com/bucket/uploads/alice/avatar__avatar96.webp",
        },
      },
    }
  );
});

test("setProfileImage rejects a profile image without verified upload metadata", async () => {
  const { driver } = buildDriver();
  const User = new UserModelStub(() => ({ users: [] }));
  const resolver = setProfileImage({
    repository: {setProfileImage: async (username, update) => User.update({where:{username},update,selectionSet:`{ users ${PROFILE_IMAGE_SELECTION} }`})},
    driver,
  });

  await assert.rejects(
    resolver(
      null,
      {
        username: "alice",
        imageUrl: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
      },
      createMockContext("alice")
    ),
    /Upload metadata not found/
  );
});

test("setProfileImage rejects updates to another user's profile image", async () => {
  const { driver } = buildDriver();
  const User = new UserModelStub(() => ({ users: [] }));
  const resolver = setProfileImage({
    repository: {setProfileImage: async (username, update) => User.update({where:{username},update,selectionSet:`{ users ${PROFILE_IMAGE_SELECTION} }`})},
    driver,
  });

  await assert.rejects(
    resolver(
      null,
      {
        username: "alice",
        imageUrl: "https://storage.googleapis.com/bucket/uploads/alice/avatar.png",
      },
      createMockContext("bob")
    ),
    /Not authorized/
  );
});
