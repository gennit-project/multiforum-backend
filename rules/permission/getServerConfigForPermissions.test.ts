import assert from "node:assert/strict";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";

async function testCachesServerConfigWithinRequest() {
  let findCalls = 0;
  const context = {
    ogm: {
      model(name: string) {
        if (name !== "ServerConfig") {
          throw new Error(`Unexpected model lookup: ${name}`);
        }

        return {
          find: async () => {
            findCalls += 1;
            return [
              {
                DefaultServerRole: { canCreateChannel: true, canUploadFile: true },
                DefaultSuspendedRole: {
                  canCreateChannel: false,
                  canUploadFile: false,
                },
                Admins: [{ username: "alice" }],
                Moderators: [{ displayName: "Mod Alice" }],
              },
            ];
          },
        };
      },
    },
  };

  await getServerConfigForPermissions(context);
  await getServerConfigForPermissions(context);

  assert.equal(findCalls, 1);
}

async function run() {
  await testCachesServerConfigWithinRequest();
  console.log("getServerConfigForPermissions tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
