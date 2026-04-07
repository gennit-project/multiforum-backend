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

test("returns the permission error when server permission check fails", async () => {
  const ctx = {
    driver: buildDriver(),
    ogm: {
      model: (name: string) => {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultServerRole: { canCreateChannel: false, canUploadFile: true },
                DefaultSuspendedRole: { canCreateChannel: false, canUploadFile: false },
              },
            ],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.ok(result instanceof Error);
});

test("returns true when server permission check succeeds", async () => {
  const ctx = {
    driver: buildDriver(),
    ogm: {
      model: (name: string) => {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultServerRole: { canCreateChannel: true, canUploadFile: true },
                DefaultSuspendedRole: { canCreateChannel: false, canUploadFile: false },
              },
            ],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
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
    ogm: {
      model: (name: string) => {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultServerRole: { canCreateChannel: true, canUploadFile: true },
                DefaultSuspendedRole: { canCreateChannel: false, canUploadFile: false },
              },
            ],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
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
    ogm: {
      model: (name: string) => {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultServerRole: { canCreateChannel: true, canUploadFile: true },
                DefaultSuspendedRole: { canCreateChannel: false, canUploadFile: false },
              },
            ],
          };
        }
        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
    user: {
      username: "time-limited-suspended-user",
      data: { ServerRoles: [] }, // Pre-populate to skip setUserDataOnContext
    },
    req: { headers: {} },
  };

  const result = await evaluateCanCreateChannelRule(ctx);
  assert.ok(result instanceof Error, "Expected an Error for time-limited suspended user");
});
