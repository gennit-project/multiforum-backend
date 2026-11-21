import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import {
  allocatePerUserNumberSnippet,
  resolveIdByPerUserNumber,
  backfillPerUserNumbers,
  IMAGE_NUMBER,
  ALBUM_NUMBER,
  COLLECTION_NUMBER,
} from "./perUserNumber.js";

test("allocatePerUserNumberSnippet interpolates the spec's labels and fields", () => {
  const snippet = allocatePerUserNumberSnippet("img", IMAGE_NUMBER);
  assert.match(snippet, /MERGE \(counter:UserImageCounter \{username: img\.uploadedByUsername\}\)/);
  assert.match(snippet, /\(existing:Image \{uploadedByUsername: counter\.username\}\)/);
  assert.match(snippet, /SET img\.imageNumber = counter\.current/);
  assert.match(snippet, /img\.uploadedByUsername IS NOT NULL AND img\.imageNumber IS NULL/);
});

const runner = (id: string | null) => ({
  run: async (_c: string, params: Record<string, unknown>) => {
    assert.ok(neo4j.isInt(params.value)); // number wrapped as a neo4j integer
    return { records: id === null ? [] : [{ get: () => id }] };
  },
});

test("resolveIdByPerUserNumber returns the id or null", async () => {
  assert.equal(await resolveIdByPerUserNumber(runner("album-9"), ALBUM_NUMBER, "alice", 9), "album-9");
  assert.equal(await resolveIdByPerUserNumber(runner(null), COLLECTION_NUMBER, "alice", 99), null);
});

test("backfillPerUserNumbers reads the owner and node counts", async () => {
  let closed = 0;
  const driver = {
    session: () => ({
      executeWrite: async (cb: (tx: any) => Promise<any>) =>
        cb({ run: async () => ({ records: [{ get: (k: string) => (k === "ownersUpdated" ? neo4j.int(2) : 5) }] }) }),
      close: async () => { closed += 1; },
    }),
  } as any;
  const result = await backfillPerUserNumbers(driver, IMAGE_NUMBER);
  assert.deepEqual(result, { ownersUpdated: 2, nodesNumbered: 5 });
  assert.equal(closed, 1);
});

test("backfillPerUserNumbers defaults missing counts to zero", async () => {
  const driver = {
    session: () => ({
      executeWrite: async (cb: (tx: any) => Promise<any>) => cb({ run: async () => ({ records: [] }) }),
      close: async () => {},
    }),
  } as any;
  assert.deepEqual(await backfillPerUserNumbers(driver, ALBUM_NUMBER), { ownersUpdated: 0, nodesNumbered: 0 });
});
