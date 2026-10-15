import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { ProvisionServerDefaultsResult } from "../seedData/provisionServerDefaults.js";
import {
  provisionInstanceOnStartup as provisionInstanceOnStartupWithDriver,
  type StartupProvisioningInput,
} from "./startupProvisioning.js";

const testDriver = {} as Driver;
const provisionInstanceOnStartup = (
  input: Omit<StartupProvisioningInput, "driver">
) => provisionInstanceOnStartupWithDriver({ driver: testDriver, ...input });

const provisionedResult: ProvisionServerDefaultsResult = {
  serverRolesUpserted: 5,
  modServerRolesUpserted: 4,
  serverConfigCreated: true,
  rolesWired: ["DefaultServerRole"],
  adminsBackfilledToSuperAdmins: [],
};

test("provisions an explicitly enabled instance", async () => {
  const calls: Array<{ serverName: string }> = [];
  const messages: string[] = [];

  const result = await provisionInstanceOnStartup({
    env: {
      MULTIFORUM_AUTO_PROVISION: "true",
      SERVER_CONFIG_NAME: "  Community Forum  ",
    },
    log: (message) => messages.push(message),
    provision: async (options) => {
      calls.push({ serverName: options.serverName });
      options.log?.("Created defaults.");
      return provisionedResult;
    },
  });

  assert.deepEqual(calls, [{ serverName: "Community Forum" }]);
  assert.deepEqual(result, {
    status: "provisioned",
    result: provisionedResult,
    bootstrapAdmin: { status: "skipped", reason: "auth-provider" },
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
      env: { MULTIFORUM_AUTO_PROVISION: "true" },
      provision: async () => provisionedResult,
    }),
    /SERVER_CONFIG_NAME is required/
  );
});

test("propagates opt-in provisioning failures so startup fails fast", async () => {
  await assert.rejects(
    provisionInstanceOnStartup({
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

test("provisions the configured local development identity after server defaults", async () => {
  const calls: string[] = [];
  const result = await provisionInstanceOnStartup({
    env: {
      MULTIFORUM_AUTO_PROVISION: "true",
      SERVER_CONFIG_NAME: "Community Forum",
      NODE_ENV: "development",
      MULTIFORUM_AUTH_PROVIDER: "local-dev",
      MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
      MULTIFORUM_BOOTSTRAP_USERNAME: "admin",
      MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
      SUPERADMIN_EMAIL: "admin@example.test",
    },
    provision: async () => {
      calls.push("defaults");
      return provisionedResult;
    },
    provisionBootstrapAdmin: async (options) => {
      calls.push(`admin:${options.username}:${options.email}:${options.serverName}`);
      return { status: "created", username: options.username };
    },
  });

  assert.deepEqual(calls, [
    "defaults",
    "admin:admin:admin@example.test:Community Forum",
  ]);
  assert.deepEqual(result, {
    status: "provisioned",
    result: provisionedResult,
    bootstrapAdmin: { status: "created", username: "admin" },
  });
});

test("fails startup when enabled local auth is incomplete", async () => {
  await assert.rejects(
    provisionInstanceOnStartup({
      env: {
        MULTIFORUM_AUTO_PROVISION: "true",
        SERVER_CONFIG_NAME: "Community Forum",
        NODE_ENV: "development",
        MULTIFORUM_AUTH_PROVIDER: "local-dev",
      },
      provision: async () => provisionedResult,
    }),
    /Local development authentication requires/
  );
});

test("uses the production default role provisioner when no seam is injected", async () => {
  const repositoryCalls: unknown[] = [];

  const result = await provisionInstanceOnStartup({
    serverDefaultsRepository: {
      async reconcile(input) {
        repositoryCalls.push(input);
        return provisionedResult;
      },
    },
    env: {
      MULTIFORUM_AUTO_PROVISION: "true",
      SERVER_CONFIG_NAME: "Community Forum",
    },
  });

  assert.equal(repositoryCalls.length, 1);
  assert.equal(
    (repositoryCalls[0] as { serverName: string }).serverName,
    "Community Forum"
  );
  assert.equal(result.status, "provisioned");
  if (result.status === "provisioned") {
    assert.equal(result.result.serverConfigCreated, true);
    assert.deepEqual(result.bootstrapAdmin, {
      status: "skipped",
      reason: "auth-provider",
    });
  }
});

test("uses the default bootstrap provisioner and forwards its logs", async () => {
  const repositoryCalls: unknown[] = [];
  const messages: string[] = [];

  const result = await provisionInstanceOnStartup({
    bootstrapAdminRepository: {
      async reconcile(input) {
        repositoryCalls.push(input);
        return { status: "created", username: input.username };
      },
    },
    env: {
      MULTIFORUM_AUTO_PROVISION: "true",
      SERVER_CONFIG_NAME: "Community Forum",
      NODE_ENV: "development",
      MULTIFORUM_AUTH_PROVIDER: "local-dev",
      MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
      MULTIFORUM_BOOTSTRAP_USERNAME: "admin",
      MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
      SUPERADMIN_EMAIL: "admin@example.test",
    },
    provision: async () => provisionedResult,
    log: (message) => messages.push(message),
  });

  assert.deepEqual(repositoryCalls, [
    {
      serverName: "Community Forum",
      email: "admin@example.test",
      username: "admin",
    },
  ]);
  assert.equal(result.status, "provisioned");
  if (result.status === "provisioned") {
    assert.deepEqual(result.bootstrapAdmin, {
      status: "created",
      username: "admin",
    });
  }
  assert.ok(
    messages.includes("[startup-provision] Created bootstrap user 'admin'.")
  );
  assert.ok(
    messages.includes(
      "[startup-provision] Connected bootstrap user 'admin' as a SuperAdmin."
    )
  );
});
