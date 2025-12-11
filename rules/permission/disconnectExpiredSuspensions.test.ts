import assert from "node:assert/strict";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";

type SuspensionStub = {
  id: string;
  username?: string | null;
  modProfileName?: string | null;
};

class ChannelModelStub {
  public updates: any[] = [];

  async update({ update }: any) {
    this.updates.push(update);
    return {};
  }
}

const buildOgm = (channelStub: ChannelModelStub) => {
  return {
    model: (name: string) => {
      if (name === "Channel") return channelStub;
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  };
};

async function testDisconnectsUserSuspensions() {
  const channelStub = new ChannelModelStub();
  const ogm = buildOgm(channelStub);

  const expiredUserSuspensions: SuspensionStub[] = [
    { id: "user-suspension-1", username: "alice" },
    { id: "user-suspension-2", username: "bob" },
  ];

  const result = await disconnectExpiredSuspensions({
    ogm,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: expiredUserSuspensions as any,
    expiredModSuspensions: [],
  });

  assert.deepEqual(result.disconnectedUserSuspensionIds, [
    "user-suspension-1",
    "user-suspension-2",
  ]);
  assert.deepEqual(result.disconnectedModSuspensionIds, []);
  assert.equal(channelStub.updates.length, 1);
  assert.ok(channelStub.updates[0].SuspendedUsers, "Expected SuspendedUsers disconnect");
}

async function testDisconnectsModSuspensions() {
  const channelStub = new ChannelModelStub();
  const ogm = buildOgm(channelStub);

  const expiredModSuspensions: SuspensionStub[] = [
    { id: "mod-suspension-1", modProfileName: "ModA" },
  ];

  const result = await disconnectExpiredSuspensions({
    ogm,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: [],
    expiredModSuspensions: expiredModSuspensions as any,
  });

  assert.deepEqual(result.disconnectedUserSuspensionIds, []);
  assert.deepEqual(result.disconnectedModSuspensionIds, ["mod-suspension-1"]);
  assert.equal(channelStub.updates.length, 1);
  assert.ok(channelStub.updates[0].SuspendedMods, "Expected SuspendedMods disconnect");
}

async function testDisconnectsBothUserAndModSuspensions() {
  const channelStub = new ChannelModelStub();
  const ogm = buildOgm(channelStub);

  const expiredUserSuspensions: SuspensionStub[] = [
    { id: "user-suspension-1", username: "alice" },
  ];
  const expiredModSuspensions: SuspensionStub[] = [
    { id: "mod-suspension-1", modProfileName: "ModA" },
  ];

  const result = await disconnectExpiredSuspensions({
    ogm,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: expiredUserSuspensions as any,
    expiredModSuspensions: expiredModSuspensions as any,
  });

  assert.deepEqual(result.disconnectedUserSuspensionIds, ["user-suspension-1"]);
  assert.deepEqual(result.disconnectedModSuspensionIds, ["mod-suspension-1"]);
  assert.equal(channelStub.updates.length, 1);
  assert.ok(channelStub.updates[0].SuspendedUsers, "Expected SuspendedUsers disconnect");
  assert.ok(channelStub.updates[0].SuspendedMods, "Expected SuspendedMods disconnect");
}

async function testNoUpdateWhenNoExpiredSuspensions() {
  const channelStub = new ChannelModelStub();
  const ogm = buildOgm(channelStub);

  const result = await disconnectExpiredSuspensions({
    ogm,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: [],
    expiredModSuspensions: [],
  });

  assert.deepEqual(result.disconnectedUserSuspensionIds, []);
  assert.deepEqual(result.disconnectedModSuspensionIds, []);
  assert.equal(channelStub.updates.length, 0, "Should not call update when no expired suspensions");
}

async function run() {
  await testDisconnectsUserSuspensions();
  await testDisconnectsModSuspensions();
  await testDisconnectsBothUserAndModSuspensions();
  await testNoUpdateWhenNoExpiredSuspensions();
  console.log("disconnectExpiredSuspensions tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
