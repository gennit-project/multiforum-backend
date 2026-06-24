import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
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

  await getServerConfigForPermissions(context as unknown as GraphQLContext);
  await getServerConfigForPermissions(context as unknown as GraphQLContext);

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
