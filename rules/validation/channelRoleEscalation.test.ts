import test from "node:test";
import assert from "node:assert/strict";
import { roleOwnerChannelNames } from "./channelRoleEscalation.js";

const owner = (uniqueName: string) => ({
  connect: { where: { node: { uniqueName } } },
});

test("extracts the explicit owner from every channel role input", () => {
  const items = [
    { channelUniqueName: "cats", name: "Reader", Owner: owner("cats") },
    { name: "Moderator", Owner: owner("dogs") },
  ];
  assert.deepEqual(roleOwnerChannelNames(items), ["cats", "dogs"]);
});

test("rejects missing, multiple, and scalar-mismatched owners", () => {
  assert.equal(roleOwnerChannelNames([{ name: "Reader" }]), null);
  assert.equal(roleOwnerChannelNames([{
    Owner: {
      connect: [
        { where: { node: { uniqueName: "cats" } } },
        { where: { node: { uniqueName: "dogs" } } },
      ],
    },
  }]), null);
  assert.equal(roleOwnerChannelNames([{
    channelUniqueName: "dogs",
    Owner: owner("cats"),
  }]), null);
});

test("handles non-array / empty / junk input", () => {
  assert.equal(roleOwnerChannelNames(undefined), null);
  assert.equal(roleOwnerChannelNames([]), null);
  assert.equal(roleOwnerChannelNames([null, "x", 3]), null);
});
