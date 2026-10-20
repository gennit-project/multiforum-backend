import assert from "node:assert/strict";
import test from "node:test";
import { getPublicCollectionSelectionSet } from "./publicCollectionsContaining.js";

test("restricted viewers filter source entities by their stored properties", () => {
  const selectionSet = getPublicCollectionSelectionSet(false);

  assert.doesNotMatch(selectionSet, /ageGateSensitive/);
  assert.equal(
    selectionSet.match(/OR: \[\{ hasSensitiveContent: false \}, \{ hasSensitiveContent: null \}\]/g)?.length,
    2,
    "downloads and their album images should both accept false or missing source flags"
  );
});

test("eligible viewers do not receive explicit age-gate filters", () => {
  const selectionSet = getPublicCollectionSelectionSet(true);

  assert.doesNotMatch(selectionSet, /hasSensitiveContent: (?:false|null)/);
  assert.doesNotMatch(selectionSet, /__DISCUSSION_AGE_FILTER__|__IMAGE_AGE_FILTER__/);
});

test("public collection channel filter and viewer mode reach the fixed read operation", async () => {
  const { default: factory } = await import("./publicCollectionsContaining.js");
  const calls: unknown[] = [];
  const resolver = factory({ driver: {} as never, collectionReadRepository: {
    findPublicContaining: async (where: unknown, mode: boolean) => { calls.push({ where, mode }); return []; },
  } as never });
  await resolver(null, { itemId: "cats", itemType: "CHANNEL" }, { mayAccessSensitiveContent: true } as never);
  assert.deepEqual(calls, [{ where: { visibility: "PUBLIC", Channels_SOME: { uniqueName: "cats" } }, mode: true }]);
});

test("public collection failure wrapping and unsupported type order are unchanged", async () => {
  const { default: factory } = await import("./publicCollectionsContaining.js");
  let reads = 0;
  const resolver = factory({ driver: {} as never, collectionReadRepository: {
    findPublicContaining: async () => { reads++; throw new Error("private failure"); },
  } as never });
  await assert.rejects(resolver(null, { itemId: "cats", itemType: "OTHER" }, {} as never), { message: "Unsupported itemType: OTHER" });
  assert.equal(reads, 0);
  await assert.rejects(resolver(null, { itemId: "cats", itemType: "CHANNEL" }, { mayAccessSensitiveContent: false } as never), { message: "Failed to fetch public collections containing item" });
});
