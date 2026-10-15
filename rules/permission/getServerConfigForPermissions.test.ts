import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";

async function testCachesServerConfigWithinRequest() {
  let findByNameCalls = 0;
  const context = {
    driver: {},
  };
  const repository = {
    async findByName() {
      findByNameCalls += 1;
      return {
        DefaultServerRole: { canCreateChannel: true, canUploadFile: true },
        DefaultSuspendedRole: {
          canCreateChannel: false,
          canUploadFile: false,
        },
        Admins: [{ username: "alice" }],
        SuperAdmins: [],
        Moderators: [{ displayName: "Mod Alice" }],
        SuspendedUsers: [],
        SuspendedMods: [],
      };
    },
  };

  await getServerConfigForPermissions(
    context as unknown as GraphQLContext,
    repository
  );
  await getServerConfigForPermissions(
    context as unknown as GraphQLContext,
    repository
  );

  assert.equal(findByNameCalls, 1);
}

async function run() {
  await testCachesServerConfigWithinRequest();
  console.log("getServerConfigForPermissions tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
