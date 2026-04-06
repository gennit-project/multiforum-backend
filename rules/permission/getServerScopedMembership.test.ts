import assert from "node:assert/strict";
import {
  evaluateServerScopedMembership,
  getServerScopedMembership,
} from "./getServerScopedMembership.js";

async function testDirectServerMembershipWins() {
  const result = evaluateServerScopedMembership({
    username: "alice",
    modProfileName: "Mod Alice",
    serverAdminUsernames: ["alice"],
    serverModeratorDisplayNames: ["Mod Alice"],
    legacyServerRoles: [],
  });

  assert.deepEqual(result, {
    isServerAdmin: true,
    isServerModerator: true,
  });
}

async function testLegacyShowAdminTagFallbackStillWorks() {
  const result = evaluateServerScopedMembership({
    username: "alice",
    serverAdminUsernames: [],
    legacyServerRoles: [{ showAdminTag: true }],
  });

  assert.deepEqual(result, {
    isServerAdmin: true,
    isServerModerator: false,
  });
}

async function testCypressAdminFallbackStillWorks() {
  const result = evaluateServerScopedMembership({
    email: "admin@example.com",
    cypressAdminTestEmail: "admin@example.com",
    serverAdminUsernames: [],
    legacyServerRoles: [],
  });

  assert.deepEqual(result, {
    isServerAdmin: true,
    isServerModerator: false,
  });
}

async function testGetServerScopedMembershipReadsServerConfigRelationships() {
  let findCalls = 0;
  const context: any = {
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
    req: {
      headers: {},
    },
    ogm: {
      model(name: string) {
        if (name === "ServerConfig") {
          return {
            find: async () => {
              findCalls += 1;
              return [
                {
                  Admins: [{ username: "alice" }],
                  Moderators: [{ displayName: "Mod Alice" }],
                },
              ];
            },
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  };

  const originalServerName = process.env.SERVER_CONFIG_NAME;
  process.env.SERVER_CONFIG_NAME = "test-server";

  try {
    await getServerScopedMembership(context);
    await getServerScopedMembership(context);

    assert.deepEqual({
      findCalls,
      cache: context.__permissionRequestCache != null,
    }, {
      findCalls: 1,
      cache: true,
    });
  } finally {
    process.env.SERVER_CONFIG_NAME = originalServerName;
  }
}

async function run() {
  await testDirectServerMembershipWins();
  await testLegacyShowAdminTagFallbackStillWorks();
  await testCypressAdminFallbackStillWorks();
  await testGetServerScopedMembershipReadsServerConfigRelationships();
  console.log("getServerScopedMembership tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
