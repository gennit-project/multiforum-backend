import assert from "node:assert/strict";
import test from "node:test";
import type { ProvisionServerDefaultsResult } from "../seedData/provisionServerDefaults.js";
import { provisionInstanceOnStartup } from "./startupProvisioning.js";

const provisionedResult: ProvisionServerDefaultsResult = {
  serverRolesUpserted: 5,
  modServerRolesUpserted: 4,
  serverConfigCreated: true,
  rolesWired: ["DefaultServerRole"],
  adminsBackfilledToSuperAdmins: [],
};

test("provisions an explicitly enabled instance", async () => {
  const ogm = { model: () => ({}) };
  const calls: Array<{ ogm: unknown; serverName: string }> = [];
  const messages: string[] = [];

  const result = await provisionInstanceOnStartup({
    ogm,
    env: {
      MULTIFORUM_AUTO_PROVISION: "true",
      SERVER_CONFIG_NAME: "  Community Forum  ",
    },
    log: (message) => messages.push(message),
    provision: async (receivedOgm, options) => {
      calls.push({ ogm: receivedOgm, serverName: options.serverName });
      options.log?.("Created defaults.");
      return provisionedResult;
    },
  });

  assert.deepEqual(calls, [{ ogm, serverName: "Community Forum" }]);
  assert.deepEqual(result, {
    status: "provisioned",
    result: provisionedResult,
  });
  assert.deepEqual(messages, [
    "[startup-provision] Created defaults.",
    "[startup-provision] Ready: 'Community Forum' has 5 server roles and 4 moderator roles.",
  ]);
});

for (const value of ["1", "yes", "on", " YES "]) {
  test(`accepts the documented opt-in value ${JSON.stringify(value)}`, async () => {
    let provisionCalls = 0;

    const result = await provisionInstanceOnStartup({
      ogm: { model: () => ({}) },
      env: {
        MULTIFORUM_AUTO_PROVISION: value,
        SERVER_CONFIG_NAME: "Community Forum",
      },
      provision: async () => {
        provisionCalls += 1;
        return provisionedResult;
      },
    });

    assert.equal(result.status, "provisioned");
    assert.equal(provisionCalls, 1);
  });
}

for (const value of [undefined, "", "false", "0", "unexpected"]) {
  test(`skips provisioning when opt-in value is ${String(value)}`, async () => {
    let provisionCalls = 0;

    const result = await provisionInstanceOnStartup({
      ogm: { model: () => ({}) },
      env: {
        MULTIFORUM_AUTO_PROVISION: value,
        SERVER_CONFIG_NAME: "Community Forum",
      },
      provision: async () => {
        provisionCalls += 1;
        return provisionedResult;
      },
    });

    assert.deepEqual({ result, provisionCalls }, {
      result: { status: "skipped", reason: "disabled" },
      provisionCalls: 0,
    });
  });
}

test("rejects an enabled instance with no server name", async () => {
  await assert.rejects(
    provisionInstanceOnStartup({
      ogm: { model: () => ({}) },
      env: { MULTIFORUM_AUTO_PROVISION: "true" },
      provision: async () => provisionedResult,
    }),
    /SERVER_CONFIG_NAME is required/
  );
});

test("propagates opt-in provisioning failures so startup fails fast", async () => {
  await assert.rejects(
    provisionInstanceOnStartup({
      ogm: { model: () => ({}) },
      env: {
        MULTIFORUM_AUTO_PROVISION: "true",
        SERVER_CONFIG_NAME: "Community Forum",
      },
      provision: async () => {
        throw new Error("database rejected defaults");
      },
    }),
    /database rejected defaults/
  );
});
