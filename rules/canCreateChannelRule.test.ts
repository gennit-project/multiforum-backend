import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCanCreateChannelRule } from "./rules.js";

const buildDriver = (userSuspensions: Array<Record<string, unknown>> = []) => ({
  session: () => ({
    run: async (query: string) => {
      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
        return {
          records: userSuspensions.map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
        return { records: [] };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
    close: async () => {},
  }),
});

const buildOgm = (defaultServerRole: { canCreateChannel: boolean; canUploadFile: boolean }) => ({
  model: (name: string) => {
    if (name === "ServerConfig") {
      return {
        find: async () => [
          {
            DefaultServerRole: defaultServerRole,
            DefaultSuspendedRole: {
              canCreateChannel: false,
              canUploadFile: false,
            },
          },
        ],
      };
    }

    if (name === "User") {
      return {
        find: async () => [],
        update: async () => ({}),
      };
    }

    throw new Error(`Unexpected model lookup: ${name}`);
  },
});

test("returns the permission error when server permission check fails", async () => {
  const ctx = {
    driver: buildDriver(),
    ogm: buildOgm({ canCreateChannel: false, canUploadFile: true }),
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.ok(result instanceof Error);
});

test("returns true when server permission check succeeds", async () => {
  const ctx = {
    driver: buildDriver(),
    ogm: buildOgm({ canCreateChannel: true, canUploadFile: true }),
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.equal(result, true);
});

test("returns error when user has an active indefinite suspension", async () => {
  const ctx = {
    driver: buildDriver([
      { id: "suspension-1", suspendedIndefinitely: true, suspendedUntil: null },
    ]),
    ogm: buildOgm({ canCreateChannel: true, canUploadFile: true }),
    user: {
      username: "suspended-user",
      data: { ServerRoles: [] }, // Pre-populate to skip setUserDataOnContext
    },
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.ok(result instanceof Error, "Expected an Error for suspended user");
});

test("returns error when user has an active time-limited suspension", async () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString(); // 24 hours from now
  const ctx = {
    driver: buildDriver([
      { id: "suspension-2", suspendedIndefinitely: false, suspendedUntil: futureDate },
    ]),
    ogm: buildOgm({ canCreateChannel: true, canUploadFile: true }),
    user: {
      username: "time-limited-suspended-user",
      data: { ServerRoles: [] }, // Pre-populate to skip setUserDataOnContext
    },
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.ok(result instanceof Error, "Expected an Error for time-limited suspended user");
});
