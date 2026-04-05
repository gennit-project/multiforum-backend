import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCanCreateChannelRule } from "./rules.js";

test("returns the permission error when server permission check fails", async () => {
  const ctx = {
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
        if (name === "Suspension") {
          return {
            find: async () => [],
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
    ogm: {
      model: (name: string) => {
        if (name === "Suspension") {
          return {
            find: async () => [],
          };
        }
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
