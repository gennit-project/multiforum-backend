import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import {
  AGE_GATE_UPGRADE_ERROR_CODE,
  findBlockedAgeGateWrites,
  rejectAgeGateWritesDuringUpgrade,
} from "./ageGateInterlockMiddleware.js";

test.describe("findBlockedAgeGateWrites", () => {
  for (const [label, args, expected] of [
    [
      "a top-level discussion update",
      { update: { hasSensitiveContent: true } },
      ["args.update.hasSensitiveContent"],
    ],
    [
      "an image upload input",
      { input: { url: "x", hasSensitiveContent: true } },
      ["args.input.hasSensitiveContent"],
    ],
    [
      "a nested relationship write",
      {
        update: {
          Album: { update: { node: { Images: [{ update: { node: { hasSensitiveContent: true } } }] } } },
        },
      },
      ["args.update.Album.update.node.Images[0].update.node.hasSensitiveContent"],
    ],
    [
      "enabling the gate",
      { update: { sensitiveContentAgeGateEnabled: true } },
      ["args.update.sensitiveContentAgeGateEnabled"],
    ],
    ["unmarking content", { update: { hasSensitiveContent: false } }, []],
    ["disabling the gate", { update: { sensitiveContentAgeGateEnabled: false } }, []],
    ["an unrelated write", { input: { title: "hello", tags: ["a"] } }, []],
  ] as const) {
    test(label, () => {
      assert.deepEqual(findBlockedAgeGateWrites(args), expected);
    });
  }
});

const info = {} as GraphQLResolveInfo;
const context = {} as GraphQLContext;

test("rejects a blocked write without running the resolver", async () => {
  let resolved = false;
  await assert.rejects(
    rejectAgeGateWritesDuringUpgrade(
      async () => { resolved = true; },
      null,
      { update: { hasSensitiveContent: true } },
      context,
      info
    ),
    (error: { extensions?: { code?: string } }) =>
      error.extensions?.code === AGE_GATE_UPGRADE_ERROR_CODE && !resolved
  );
});

test("runs other mutations normally", async () => {
  const result = await rejectAgeGateWritesDuringUpgrade(
    async () => "ok",
    null,
    { update: { title: "hello" } },
    context,
    info
  );

  assert.equal(result, "ok");
});
