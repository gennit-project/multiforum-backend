import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCanSuspendUser } from "./canSuspendAndUnsuspendUser.js";
import { ERROR_MESSAGES } from "../errorMessages.js";

const base = {
  hasChannel: false,
  targetUsername: "target",
  targetIsServerAdmin: false,
  isChannelOwner: false,
  isSiteAdmin: false,
};

// --- Server-scoped (no channel) ---

test("server scope: delegates to server permission for a normal target", () => {
  const decision = evaluateCanSuspendUser({ ...base, hasChannel: false });
  assert.deepEqual(decision, { type: "delegateServer" });
});

test("server scope: delegates to server permission when no target user", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: false,
    targetUsername: undefined,
    targetIsServerAdmin: true, // ignored without a target username
  });
  assert.deepEqual(decision, { type: "delegateServer" });
});

test("server scope: denies suspending a server admin when not a site admin", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: false,
    targetIsServerAdmin: true,
    isSiteAdmin: false,
  });
  assert.equal(decision.type, "deny");
  assert.equal(
    (decision as { error: Error }).error.message,
    ERROR_MESSAGES.channel.cantSuspendOwner
  );
});

test("server scope: allows a site admin to suspend a server admin", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: false,
    targetIsServerAdmin: true,
    isSiteAdmin: true,
  });
  assert.deepEqual(decision, { type: "allow" });
});

// --- Channel-scoped ---

test("channel scope: delegates to channel permission for a non-owner target", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: true,
    isChannelOwner: false,
  });
  assert.deepEqual(decision, { type: "delegateChannel" });
});

test("channel scope: delegates to channel permission when no target user", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: true,
    targetUsername: undefined,
    isChannelOwner: true, // ignored without a target username
  });
  assert.deepEqual(decision, { type: "delegateChannel" });
});

test("channel scope: denies suspending a channel owner when not a site admin", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: true,
    isChannelOwner: true,
    isSiteAdmin: false,
  });
  assert.equal(decision.type, "deny");
  assert.equal(
    (decision as { error: Error }).error.message,
    ERROR_MESSAGES.channel.cantSuspendOwner
  );
});

test("channel scope: allows a site admin to suspend a channel owner", () => {
  const decision = evaluateCanSuspendUser({
    ...base,
    hasChannel: true,
    isChannelOwner: true,
    isSiteAdmin: true,
  });
  assert.deepEqual(decision, { type: "allow" });
});
