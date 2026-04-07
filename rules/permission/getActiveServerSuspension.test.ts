import assert from "node:assert/strict";
import test from "node:test";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastDate = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const buildDriver = (responses: {
  userSuspensions?: any[];
  modSuspensions?: any[];
}) => ({
  session: () => ({
    run: async (query: string) => {
      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
        return {
          records: (responses.userSuspensions ?? []).map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
        return {
          records: (responses.modSuspensions ?? []).map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
    close: async () => {},
  }),
});

test("returns active server user suspension metadata", async () => {
  const result = await getActiveServerSuspension({
    context: {
      driver: buildDriver({
        userSuspensions: [
          {
            id: "server-user-1",
            username: "alice",
            serverName: "test-server",
            suspendedUntil: futureDate(),
            suspendedIndefinitely: false,
            RelatedIssue: { id: "issue-1", issueNumber: 12 },
          },
        ],
      }),
    },
    username: "alice",
  });

  assert.equal(result.activeSuspension?.id, "server-user-1");
  assert.equal(result.isSuspended, true);
  assert.equal(result.relatedIssueNumber, 12);
  assert.equal(result.suspendedEntity, "user");
});

test("returns expired server mod suspensions for cleanup", async () => {
  const result = await getActiveServerSuspension({
    context: {
      driver: buildDriver({
        modSuspensions: [
          {
            id: "server-mod-1",
            modProfileName: "Mod Jane",
            serverName: "test-server",
            suspendedUntil: pastDate(),
            suspendedIndefinitely: false,
          },
        ],
      }),
    },
    modProfileName: "Mod Jane",
  });

  assert.equal(result.isSuspended, false);
  assert.equal(result.expiredModSuspensions.length, 1);
  assert.equal(result.expiredModSuspensions[0].id, "server-mod-1");
});
