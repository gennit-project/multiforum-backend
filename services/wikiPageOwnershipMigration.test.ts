import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditWikiPageOwnership,
  migrateWikiPageOwnership,
} from "./wikiPageOwnershipMigration.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const ownershipRows = [
  record({
    id: "healthy", slug: "guide", storedChannelUniqueName: "cats",
    ownerChannelUniqueNames: ["cats"], ownerRelationshipCount: neo4j.int(1),
    matchingChannelCount: neo4j.int(1),
  }),
  record({
    id: "orphaned", slug: "faq", storedChannelUniqueName: "cats",
    ownerChannelUniqueNames: [], ownerRelationshipCount: neo4j.int(0),
    matchingChannelCount: neo4j.int(1),
  }),
  record({
    id: "missing-channel", slug: "lost", storedChannelUniqueName: "gone",
    ownerChannelUniqueNames: [], ownerRelationshipCount: neo4j.int(0),
    matchingChannelCount: neo4j.int(0),
  }),
  record({
    id: "mismatch", slug: "rules", storedChannelUniqueName: "dogs",
    ownerChannelUniqueNames: ["cats"], ownerRelationshipCount: neo4j.int(1),
    matchingChannelCount: neo4j.int(1),
  }),
  record({
    id: "multiply-owned", slug: null, storedChannelUniqueName: null,
    ownerChannelUniqueNames: ["cats", "dogs"], ownerRelationshipCount: 2,
    matchingChannelCount: 0,
  }),
];

test("wiki ownership audit reports repairable orphans and unsafe records", async () => {
  let calls = 0;
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => ({ records: calls++ === 0 ? ownershipRows : [
        record({ channelUniqueName: "cats", slug: "guide", ids: ["a", "b"] }),
      ] }),
      close: async () => { closed = true; },
    }),
  } as unknown as Driver;

  const report = await auditWikiPageOwnership(driver);
  assert.deepEqual(report.orphaned.map(({ id }) => id), ["orphaned", "missing-channel"]);
  assert.deepEqual(report.missingChannels.map(({ id }) => id), ["missing-channel"]);
  assert.deepEqual(report.mismatched.map(({ id }) => id), ["mismatch"]);
  assert.deepEqual(report.multiplyOwned.map(({ id }) => id), ["multiply-owned"]);
  assert.deepEqual(report.missingRouteIdentity.map(({ id }) => id), ["multiply-owned"]);
  assert.deepEqual(report.duplicateRoutes[0].ids, ["a", "b"]);
  assert.equal(closed, true);
});

test("migration refuses ambiguous data without writing", async () => {
  let calls = 0;
  let writes = 0;
  const transaction = {
    run: async (query: string) => {
      if (query.includes("MERGE")) writes += 1;
      return { records: calls++ === 0 ? ownershipRows : [] };
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
      close: async () => {},
    }),
  } as unknown as Driver;
  await assert.rejects(migrateWikiPageOwnership(driver), /Cannot backfill/);
  assert.equal(writes, 0);
});

test("migration backfills only ownerless pages after a clean audit", async () => {
  let calls = 0;
  const queries: string[] = [];
  const transaction = {
    run: async (query: string) => {
      queries.push(query);
      if (calls++ === 0) return { records: [ownershipRows[1]] };
      if (calls === 2) return { records: [] };
      return { records: [record({ linkedPages: neo4j.int(1) })] };
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
      close: async () => {},
    }),
  } as unknown as Driver;
  const report = await migrateWikiPageOwnership(driver);
  assert.equal(report.linkedPages, 1);
  assert.match(queries[2], /MERGE \(channel\)-\[:OWNS_WIKI_PAGE\]->\(page\)/);
});
