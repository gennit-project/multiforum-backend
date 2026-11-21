import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { backfillImageNumbers } from "./imageNumberBackfill.js";
import {
  backfillAlbumNumbers,
  backfillCollectionNumbers,
} from "./albumCollectionNumberBackfill.js";

// Mock driver whose write transactions return owner/node counts. The owner
// denormalize step ignores the result; the per-user backfill reads the counts.
const countingDriver = (owners: number, nodes: number) => {
  let closed = 0;
  const run = async () => ({
    records: [
      {
        get: (k: string) =>
          k === "ownersUpdated" ? neo4j.int(owners) : k === "nodesNumbered" ? neo4j.int(nodes) : null,
      },
    ],
  });
  return {
    get closed() {
      return closed;
    },
    driver: {
      session: () => ({
        executeWrite: async (cb: (tx: any) => Promise<any>) => cb({ run }),
        close: async () => {
          closed += 1;
        },
      }),
    } as any,
  };
};

test("backfillImageNumbers denormalizes the owner then numbers each user's images", async () => {
  const d = countingDriver(2, 4);
  assert.deepEqual(await backfillImageNumbers(d.driver), { ownersUpdated: 2, nodesNumbered: 4 });
  // one session for the denormalize step + one for the per-user backfill
  assert.equal(d.closed, 2);
});

test("backfillAlbumNumbers and backfillCollectionNumbers return the counts", async () => {
  assert.deepEqual(await backfillAlbumNumbers(countingDriver(1, 3).driver), { ownersUpdated: 1, nodesNumbered: 3 });
  assert.deepEqual(await backfillCollectionNumbers(countingDriver(0, 0).driver), { ownersUpdated: 0, nodesNumbered: 0 });
});
