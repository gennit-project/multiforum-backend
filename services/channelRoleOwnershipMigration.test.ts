import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditChannelRoleOwnership,
  migrateChannelRoleOwnership,
} from "./channelRoleOwnershipMigration.js";

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const role = (overrides: Record<string, unknown> = {}) => record({
  elementId: "4:role:1",
  id: null,
  name: "Reader",
  storedChannelUniqueName: "cats",
  attachedChannelUniqueNames: ["cats"],
  ownerChannelUniqueNames: [],
  ownerRelationshipCount: neo4j.int(0),
  matchingChannelCount: neo4j.int(1),
  ...overrides,
});

test("channel role ownership audit classifies unsafe legacy states", async () => {
  let call = 0;
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => {
        call += 1;
        if (call === 1) return { records: [
          role(),
          role({
            elementId: "4:role:2",
            name: "Ambiguous",
            attachedChannelUniqueNames: ["cats", "dogs"],
          }),
          role({
            elementId: "4:role:3",
            name: "Mismatch",
            storedChannelUniqueName: "dogs",
          }),
          role({
            elementId: "4:role:4",
            name: "Missing",
            storedChannelUniqueName: "gone",
            attachedChannelUniqueNames: [],
            matchingChannelCount: 0,
          }),
          role({
            elementId: "4:role:5",
            ownerChannelUniqueNames: ["dogs"],
            ownerRelationshipCount: 1,
          }),
          role({ elementId: "4:role:6" }),
        ] };
        if (call === 2) return { records: [] };
        return { records: [record({ name: "ChannelRole_name" })] };
      },
      close: async () => { closed = true; },
    }),
  } as unknown as Driver;

  const report = await auditChannelRoleOwnership(driver);
  assert.deepEqual(
    report.ambiguousAttachments.map(({ elementId }) => elementId),
    ["4:role:2"]
  );
  assert.deepEqual(
    report.mismatchedIdentity.map(({ elementId }) => elementId),
    ["4:role:3"]
  );
  assert.deepEqual(
    report.missingChannels.map(({ elementId }) => elementId).sort(),
    ["4:role:2", "4:role:4"].sort()
  );
  assert.deepEqual(
    report.invalidOwners.map(({ elementId }) => elementId),
    ["4:role:5"]
  );
  assert.deepEqual(report.duplicateIdentities[0].elementIds, [
    "4:role:1", "4:role:5", "4:role:6",
  ]);
  assert.deepEqual(report.legacyGlobalNameConstraints, ["ChannelRole_name"]);
  assert.equal(closed, true);
});

test("migration refuses unsafe role ownership without opening a write transaction", async () => {
  let call = 0;
  let writes = 0;
  const driver = {
    session: () => ({
      run: async () => ({ records: ++call === 1
        ? [role({ attachedChannelUniqueNames: ["cats", "dogs"] })]
        : [] }),
      executeWrite: async () => { writes += 1; },
      close: async () => {},
    }),
  } as unknown as Driver;

  await assert.rejects(migrateChannelRoleOwnership(driver), /Cannot backfill/);
  assert.equal(writes, 0);
});

test("migration links both role kinds, assigns identity, and drops legacy constraints", async () => {
  let readCall = 0;
  let sessionCount = 0;
  const queries: string[] = [];
  const params: Array<Record<string, unknown> | undefined> = [];
  const cleanChannelRole = role();
  const cleanModRole = role({
    elementId: "4:mod-role:1",
    name: "Moderator",
  });
  const driver = {
    session: () => {
      sessionCount += 1;
      if (sessionCount === 1) {
        return {
          run: async () => {
            readCall += 1;
            if (readCall === 1) return { records: [cleanChannelRole] };
            if (readCall === 2) return { records: [cleanModRole] };
            return { records: [
              record({ name: "ChannelRole_name" }),
              record({ name: "ModChannelRole_name" }),
            ] };
          },
          close: async () => {},
        };
      }
      const transaction = {
        run: async (query: string, input?: Record<string, unknown>) => {
          queries.push(query);
          params.push(input);
          return { records: [record({ linkedRoles: neo4j.int(1) })] };
        },
      };
      return {
        executeWrite: async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
        run: async (query: string) => {
          queries.push(query);
          return { records: [] };
        },
        close: async () => {},
      };
    },
  } as unknown as Driver;

  const result = await migrateChannelRoleOwnership(driver);
  assert.equal(result.linkedChannelRoles, 1);
  assert.equal(result.linkedModChannelRoles, 1);
  assert.equal(result.droppedLegacyConstraints, 2);
  assert.match(queries[0], /OWNS_CHANNEL_ROLE/);
  assert.match(queries[1], /OWNS_MOD_CHANNEL_ROLE/);
  assert.match(queries[2], /DROP CONSTRAINT `ChannelRole_name` IF EXISTS/);
  assert.deepEqual(
    (params[0]?.roles as Array<Record<string, unknown>>)[0],
    { elementId: "4:role:1", channelUniqueName: "cats" }
  );
});
