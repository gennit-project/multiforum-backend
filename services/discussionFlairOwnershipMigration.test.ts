import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditDiscussionFlairOwnership,
  migrateDiscussionFlairOwnership,
} from "./discussionFlairOwnershipMigration.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const ownershipRows = [
  record({
    id: "healthy",
    storedChannelUniqueName: "cats",
    ownerChannelUniqueNames: ["cats"],
  }),
  record({
    id: "mismatched",
    storedChannelUniqueName: "dogs",
    ownerChannelUniqueNames: ["cats"],
  }),
  record({
    id: "orphaned",
    storedChannelUniqueName: "cats",
    ownerChannelUniqueNames: [],
  }),
  record({
    id: "multiply-owned",
    storedChannelUniqueName: null,
    ownerChannelUniqueNames: ["cats", "dogs"],
  }),
];

test("ownership audit classifies legacy flair problems and closes its session", async () => {
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => ({ records: ownershipRows }),
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  const report = await auditDiscussionFlairOwnership(driver);

  assert.deepEqual(report.orphaned.map(({ id }) => id), ["orphaned"]);
  assert.deepEqual(report.multiplyOwned.map(({ id }) => id), [
    "multiply-owned",
  ]);
  assert.deepEqual(report.mismatched.map(({ id }) => id), [
    "mismatched",
    "orphaned",
  ]);
  assert.equal(report.storedPropertyCount, 3);
  assert.equal(closed, true);
});

test("migration refuses to remove properties from structurally ambiguous flairs", async () => {
  let writeCount = 0;
  const transaction = {
    run: async (query: string) => {
      if (query.includes("ownerChannelUniqueNames")) {
        return { records: ownershipRows };
      }
      writeCount += 1;
      return { records: [] };
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      close: async () => {},
    }),
  } as unknown as Driver;

  await assert.rejects(
    migrateDiscussionFlairOwnership(driver),
    /orphaned or multiply-owned flairs exist/
  );
  assert.equal(writeCount, 0);
});

test("migration removes only the redundant scalar after ownership is unambiguous", async () => {
  const queries: string[] = [];
  const transaction = {
    run: async (query: string) => {
      queries.push(query);
      if (query.includes("ownerChannelUniqueNames")) {
        return {
          records: [
            record({
              id: "mismatched",
              storedChannelUniqueName: "dogs",
              ownerChannelUniqueNames: ["cats"],
            }),
          ],
        };
      }
      return {
        records: [record({ removedStoredProperties: neo4j.int(1) })],
      };
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      close: async () => {},
    }),
  } as unknown as Driver;

  const report = await migrateDiscussionFlairOwnership(driver);

  assert.equal(report.removedStoredProperties, 1);
  assert.deepEqual(report.mismatched.map(({ id }) => id), ["mismatched"]);
  assert.match(queries[1], /REMOVE flair\.channelUniqueName/);
});
