import assert from "node:assert/strict";
import { hasServerModPermission } from "./hasServerModPermission.js";

const buildDriver = (responses: { modSuspensions?: any[] }) => ({
  session: () => ({
    run: async (query: string) => {
      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
        return {
          records: (responses.modSuspensions ?? []).map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
        return { records: [] };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
    close: async () => {},
  }),
});

async function testServerModeratorUsesElevatedRoleForSuspendPermission() {
  const result = await hasServerModPermission("canSuspendUser", {
    driver: buildDriver({}),
    user: {
      username: "alice",
      email: "alice@example.com",
      data: {
        ModerationProfile: {
          displayName: "Mod Alice",
        },
        ServerRoles: [],
      },
    },
    req: { headers: {} },
    ogm: {
      model(name: string) {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultModRole: { canSuspendUser: false },
                DefaultElevatedModRole: { canSuspendUser: true },
                DefaultSuspendedModRole: { canSuspendUser: false },
                Admins: [],
                Moderators: [{ displayName: "Mod Alice" }],
                SuspendedUsers: [],
                SuspendedMods: [],
              },
            ],
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  });

  assert.equal(result, true);
}

async function testSuspendedServerModUsesSuspendedRole() {
  const result = await hasServerModPermission("canSuspendUser", {
    driver: buildDriver({
      modSuspensions: [
        {
          id: "server-mod-1",
          modProfileName: "Mod Alice",
          suspendedIndefinitely: true,
          suspendedUntil: null,
        },
      ],
    }),
    user: {
      username: "alice",
      email: "alice@example.com",
      data: {
        ModerationProfile: {
          displayName: "Mod Alice",
        },
        ServerRoles: [],
      },
    },
    req: { headers: {} },
    ogm: {
      model(name: string) {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultModRole: { canSuspendUser: true },
                DefaultElevatedModRole: { canSuspendUser: true },
                DefaultSuspendedModRole: { canSuspendUser: false },
                Admins: [],
                Moderators: [{ displayName: "Mod Alice" }],
                SuspendedUsers: [],
                SuspendedMods: [],
              },
            ],
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  });

  assert.ok(result instanceof Error);
  assert.equal(result.message, "You do not have permission to do that.");
}

async function testServerAdminBypassesServerModRoleChecks() {
  const result = await hasServerModPermission("canSuspendUser", {
    driver: buildDriver({}),
    user: {
      username: "alice",
      email: "alice@example.com",
      data: {
        ModerationProfile: {
          displayName: "Mod Alice",
        },
        ServerRoles: [],
      },
    },
    req: { headers: {} },
    ogm: {
      model(name: string) {
        if (name === "ServerConfig") {
          return {
            find: async () => [
              {
                DefaultModRole: { canSuspendUser: false },
                DefaultElevatedModRole: { canSuspendUser: false },
                DefaultSuspendedModRole: { canSuspendUser: false },
                Admins: [{ username: "alice" }],
                Moderators: [],
                SuspendedUsers: [],
                SuspendedMods: [],
              },
            ],
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  });

  assert.equal(result, true);
}

async function run() {
  await testServerModeratorUsesElevatedRoleForSuspendPermission();
  await testSuspendedServerModUsesSuspendedRole();
  await testServerAdminBypassesServerModRoleChecks();
  console.log("hasServerModPermission tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
