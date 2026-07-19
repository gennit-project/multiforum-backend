import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import requestDownloadableFileReview from "./requestDownloadableFileReview.js";

const contextFor = (username: string) => ({
  user: { username },
}) as GraphQLContext;

test("records a creator review request for a held file", async () => {
  const updates: any[] = [];
  let finds = 0;
  const resolver = requestDownloadableFileReview({
    DownloadableFile: {
      find: async () => {
        finds += 1;
        return finds === 1
          ? [{
              scanStatus: "SUSPICIOUS",
              uploadedByUsername: "alice",
              Discussion: { Author: { username: "alice" } },
            }]
          : [{ id: "file-1", reviewRequestedByUsername: "alice" }];
      },
      update: async (args: unknown) => {
        updates.push(args);
        return {};
      },
    } as any,
  });

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", reason: "This is a false positive" },
    contextFor("alice") as any
  );

  assert.deepEqual({
    update: {
      ...updates[0].update,
      reviewRequestedAt: Boolean(updates[0].update.reviewRequestedAt),
    },
    result,
  }, {
    update: {
      reviewRequestedAt: true,
      reviewRequestReason: "This is a false positive",
      reviewRequestedByUsername: "alice",
    },
    result: { id: "file-1", reviewRequestedByUsername: "alice" },
  });
});

test("rejects review requests from unrelated users", async () => {
  const resolver = requestDownloadableFileReview({
    DownloadableFile: {
      find: async () => [{
        scanStatus: "INFECTED",
        uploadedByUsername: "alice",
        Discussion: { Author: { username: "alice" } },
      }],
    } as any,
  });

  await assert.rejects(
    resolver(
      null,
      { downloadableFileId: "file-1" },
      contextFor("bob") as any
    ),
    /Only the file creator/
  );
});

test("rejects review requests for files that are not held", async () => {
  const resolver = requestDownloadableFileReview({
    DownloadableFile: {
      find: async () => [{
        scanStatus: "CLEAN",
        uploadedByUsername: "alice",
      }],
    } as any,
  });

  await assert.rejects(
    resolver(
      null,
      { downloadableFileId: "file-1" },
      contextFor("alice") as any
    ),
    /Only held security scans/
  );
});
