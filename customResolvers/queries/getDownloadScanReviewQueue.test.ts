import assert from "node:assert/strict";
import test from "node:test";
import getDownloadScanReviewQueue from "./getDownloadScanReviewQueue.js";

test("returns held files with creator requests first", async () => {
  const calls: any[] = [];
  let closed = false;
  const resolver = getDownloadScanReviewQueue({
    driver: {
      session: () => ({
        run: async (query: string, params: unknown) => {
          calls.push({ query, params });
          return {
            records: [{
              get: () => ({
                downloadableFileId: "file-1",
                scanStatus: "SUSPICIOUS",
                reviewRequestedAt: "2026-07-19T00:00:00Z",
              }),
            }],
          };
        },
        close: async () => { closed = true; },
      }),
    } as any,
  });

  const result = await resolver(null, { limit: 500 });

  assert.deepEqual({
    result,
    limit: calls[0].params.limit,
    includesHeldStatuses: calls[0].query.includes("['SUSPICIOUS', 'INFECTED']"),
    prioritizesRequests: calls[0].query.includes("file.reviewRequestedAt IS NULL"),
    closed,
  }, {
    result: [{
      downloadableFileId: "file-1",
      scanStatus: "SUSPICIOUS",
      reviewRequestedAt: "2026-07-19T00:00:00Z",
    }],
    limit: 100,
    includesHeldStatuses: true,
    prioritizesRequests: true,
    closed: true,
  });
});
