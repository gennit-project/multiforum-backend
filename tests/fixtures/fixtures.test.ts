import test from "node:test";
import assert from "node:assert/strict";
import {
  makeContext,
  makeDriver,
  makeOgm,
  makeRecords,
  makeResult,
  makeUser,
} from "./index.js";

test("makeRecords builds records readable with .get()", () => {
  const [record] = makeRecords([{ updated: 3, name: "alice" }]);
  assert.equal(record.get("updated"), 3);
  assert.equal(record.get("name"), "alice");
  assert.deepEqual(record.toObject(), { updated: 3, name: "alice" });
});

test("makeResult mirrors session.run output", () => {
  const result = makeResult([{ count: 1 }]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].get("count"), 1);
});

test("makeDriver routes queries by substring and tracks calls", async () => {
  const { driver, calls } = makeDriver({
    routes: [{ match: "MATCH (u:User)", rows: [{ username: "alice" }] }],
  });
  const session = driver.session({ defaultAccessMode: "READ" }) as {
    run: (q: string, p?: Record<string, unknown>) => Promise<{ records: any[] }>;
    close: () => Promise<void>;
  };

  const result = await session.run("MATCH (u:User) RETURN u", { id: "1" });
  await session.close();

  assert.equal(result.records[0].get("username"), "alice");
  assert.equal(calls.sessions, 1);
  assert.equal(calls.closes, 1);
  assert.deepEqual(calls.run[0], ["MATCH (u:User) RETURN u", { id: "1" }]);
  assert.deepEqual(calls.sessionConfig[0], { defaultAccessMode: "READ" });
});

test("makeDriver supports regex routes and a function for rows", async () => {
  const { driver } = makeDriver({
    routes: [
      {
        match: /SUSPENDED_AS_USER/,
        rows: (_query, params) => [{ echoed: params.userId }],
      },
    ],
  });
  const session = driver.session() as {
    run: (q: string, p?: Record<string, unknown>) => Promise<{ records: any[] }>;
  };
  const result = await session.run("... SUSPENDED_AS_USER ...", { userId: "u1" });
  assert.equal(result.records[0].get("echoed"), "u1");
});

test("makeDriver onUnmatched:'throw' surfaces unexpected queries", async () => {
  const { driver } = makeDriver({ onUnmatched: "throw" });
  const session = driver.session() as { run: (q: string) => Promise<unknown> };
  await assert.rejects(session.run("MATCH (n) RETURN n"), /Unexpected query/);
});

test("makeOgm returns stubbed methods and no-op defaults", async () => {
  const created: unknown[] = [];
  const { ogm, calls } = makeOgm({
    User: {
      find: async () => [{ username: "alice" }],
      create: async (input: unknown) => {
        created.push(input);
        return { users: [{ username: "alice" }] };
      },
    },
  });

  const userModel = ogm.model("User");
  assert.deepEqual(await userModel.find(), [{ username: "alice" }]);
  await userModel.create({ input: [] });
  // Unspecified method falls back to a no-op rather than crashing.
  assert.deepEqual(await userModel.update(), {});
  assert.equal(created.length, 1);
  assert.deepEqual(calls.models, ["User"]);
});

test("makeOgm throws on an unexpected model lookup", () => {
  const { ogm } = makeOgm({});
  assert.throws(() => ogm.model("Ghost"), /Unexpected model lookup: Ghost/);
});

test("makeUser carries server roles where the permission system reads them", () => {
  const user = makeUser({ username: "alice", ServerRoles: [{ canCreateChannel: true }] });
  assert.equal(user.username, "alice");
  assert.deepEqual(user.data.ServerRoles, [{ canCreateChannel: true }]);
});

test("makeContext composes driver, ogm, and user", () => {
  const { context } = makeContext({
    user: makeUser({ username: "bob" }),
    models: { User: { find: async () => [] } },
  });
  assert.equal((context.user as { username: string }).username, "bob");
  assert.ok(context.driver);
  assert.ok(context.ogm);
});

test("makeContext user:null simulates an unauthenticated request", () => {
  const { context } = makeContext({ user: null });
  assert.equal(context.user, null);
});
