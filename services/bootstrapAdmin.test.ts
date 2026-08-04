import assert from "node:assert/strict";
import test from "node:test";
import {
  provisionBootstrapAdmin,
  provisionBootstrapAdminFromOgm,
} from "./bootstrapAdmin.js";

const baseInput = () => ({
  serverName: "Community Forum",
  email: "admin@example.test",
  username: "admin",
});

test("creates the first user and connects it as SuperAdmin", async () => {
  const userCreates: unknown[] = [];
  const configUpdates: unknown[] = [];
  const messages: string[] = [];
  let userFindCall = 0;

  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    User: {
      find: async () => {
        userFindCall += 1;
        return [];
      },
      create: async (args) => userCreates.push(args),
    },
    Email: { find: async () => [] },
    ServerConfig: {
      find: async () => [{ serverName: "Community Forum", SuperAdmins: [] }],
      update: async (args) => configUpdates.push(args),
    },
    log: (message) => messages.push(message),
  });

  assert.equal(userFindCall, 2);
  assert.deepEqual(userCreates, [
    {
      input: [
        {
          username: "admin",
          Email: { create: { node: { address: "admin@example.test" } } },
          ModerationProfile: {
            create: { node: { displayName: "bootstrap-admin" } },
          },
        },
      ],
    },
  ]);
  assert.deepEqual(configUpdates, [
    {
      where: { serverName: "Community Forum" },
      update: {
        SuperAdmins: [
          { connect: [{ where: { node: { username: "admin" } } }] },
        ],
      },
    },
  ]);
  assert.deepEqual(result, { status: "created", username: "admin" });
  assert.deepEqual(messages, [
    "Created bootstrap user 'admin'.",
    "Connected bootstrap user 'admin' as a SuperAdmin.",
  ]);
});

test("connects an existing matching identity without recreating it", async () => {
  let createCalls = 0;
  let updateCalls = 0;
  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    User: {
      find: async () => [
        { username: "admin", Email: { address: "admin@example.test" } },
      ],
      create: async () => {
        createCalls += 1;
      },
    },
    Email: {
      find: async () => [
        { address: "admin@example.test", User: { username: "admin" } },
      ],
    },
    ServerConfig: {
      find: async () => [{ SuperAdmins: [] }],
      update: async () => {
        updateCalls += 1;
      },
    },
  });

  assert.deepEqual({ result, createCalls, updateCalls }, {
    result: { status: "connected", username: "admin" },
    createCalls: 0,
    updateCalls: 1,
  });
});

test("is unchanged when the matching identity is already a SuperAdmin", async () => {
  let updateCalls = 0;
  const messages: string[] = [];
  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    User: {
      find: async () => [
        { username: "admin", Email: { address: "admin@example.test" } },
      ],
    },
    Email: {
      find: async () => [
        { address: "admin@example.test", User: { username: "admin" } },
      ],
    },
    ServerConfig: {
      find: async () => [{ SuperAdmins: [{ username: "admin" }] }],
      update: async () => {
        updateCalls += 1;
      },
    },
    log: (message) => messages.push(message),
  });

  assert.deepEqual({ result, updateCalls, messages }, {
    result: { status: "unchanged", username: "admin" },
    updateCalls: 0,
    messages: ["Bootstrap user 'admin' is already a SuperAdmin."],
  });
});

test("does not create a bootstrap identity in a non-empty database", async () => {
  let findCall = 0;
  let createCalls = 0;
  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    User: {
      find: async () => {
        findCall += 1;
        return findCall === 2 ? [{ username: "someone" }] : [];
      },
      create: async () => {
        createCalls += 1;
      },
    },
    Email: { find: async () => [] },
    ServerConfig: {
      find: async () => {
        throw new Error("ServerConfig must not be queried after a skip");
      },
    },
  });

  assert.deepEqual({ result, createCalls }, {
    result: { status: "skipped", reason: "database-not-empty" },
    createCalls: 0,
  });
});

test("rejects username and email collisions", async () => {
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: {
        find: async () => [
          { username: "admin", Email: { address: "other@example.test" } },
        ],
      },
      Email: { find: async () => [] },
      ServerConfig: { find: async () => [] },
    }),
    /username is linked to a different email/
  );

  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: { find: async () => [] },
      Email: {
        find: async () => [
          { address: "admin@example.test", User: { username: "someone" } },
        ],
      },
      ServerConfig: { find: async () => [] },
    }),
    /admin@example\.test.*linked to a different username/
  );
});

test("rejects matching records whose identity relationships are missing", async () => {
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: {
        find: async () => [{ username: "admin", Email: null }],
      },
      Email: { find: async () => [] },
      ServerConfig: { find: async () => [] },
    }),
    /username is linked to a different email/
  );

  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: { find: async () => [] },
      Email: {
        find: async () => [{ address: "admin@example.test", User: null }],
      },
      ServerConfig: { find: async () => [] },
    }),
    /admin@example\.test.*linked to a different username/
  );
});

test("rejects an incomplete existing user/email relationship", async () => {
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: {
        find: async () => [
          { username: "admin", Email: { address: "admin@example.test" } },
        ],
      },
      Email: { find: async () => [] },
      ServerConfig: { find: async () => [] },
    }),
    /relationship is incomplete/
  );
});

test("fails fast when the provisioned ServerConfig cannot be found", async () => {
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: {
        find: async () => [
          { username: "admin", Email: { address: "admin@example.test" } },
        ],
      },
      Email: {
        find: async () => [
          { address: "admin@example.test", User: { username: "admin" } },
        ],
      },
      ServerConfig: { find: async () => [] },
    }),
    /ServerConfig 'Community Forum' does not exist/
  );
});

test("fails clearly when required model mutations are unavailable", async () => {
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: { find: async () => [] },
      Email: { find: async () => [] },
      ServerConfig: { find: async () => [] },
    }),
    /User model does not support bootstrap creation/
  );

  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      User: {
        find: async () => [
          { username: "admin", Email: { address: "admin@example.test" } },
        ],
      },
      Email: {
        find: async () => [
          { address: "admin@example.test", User: { username: "admin" } },
        ],
      },
      ServerConfig: { find: async () => [{ SuperAdmins: [] }] },
    }),
    /ServerConfig model does not support bootstrap updates/
  );
});

test("ignores malformed SuperAdmin entries while reconciling the identity", async () => {
  let updateCalls = 0;
  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    User: {
      find: async () => [
        { username: "admin", Email: { address: "admin@example.test" } },
      ],
    },
    Email: {
      find: async () => [
        { address: "admin@example.test", User: { username: "admin" } },
      ],
    },
    ServerConfig: {
      find: async () => [
        { SuperAdmins: [null, {}, { username: "someone-else" }] },
      ],
      update: async () => {
        updateCalls += 1;
      },
    },
  });

  assert.deepEqual({ result, updateCalls }, {
    result: { status: "connected", username: "admin" },
    updateCalls: 1,
  });
});

test("resolves the required models from OGM", async () => {
  const modelNames: string[] = [];
  const models = {
    User: {
      find: async () => [
        { username: "admin", Email: { address: "admin@example.test" } },
      ],
    },
    Email: {
      find: async () => [
        { address: "admin@example.test", User: { username: "admin" } },
      ],
    },
    ServerConfig: {
      find: async () => [{ SuperAdmins: [{ username: "admin" }] }],
    },
  };

  const result = await provisionBootstrapAdminFromOgm(
    {
      model: (name) => {
        modelNames.push(name);
        return models[name as keyof typeof models];
      },
    },
    baseInput()
  );

  assert.deepEqual(modelNames, ["User", "Email", "ServerConfig"]);
  assert.deepEqual(result, { status: "unchanged", username: "admin" });
});
