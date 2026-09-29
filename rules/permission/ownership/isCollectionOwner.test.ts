import assert from "node:assert/strict";
import test from "node:test";
import { collectCollectionIds } from "./isCollectionOwner.js";

test("collectCollectionIds reads the nested addToCollection input", () => {
  const collectionIds = collectCollectionIds(undefined, {
    input: { collectionId: "collection-1" },
  });

  assert.deepEqual(collectionIds, ["collection-1"]);
});

test("collectCollectionIds retains top-level collection mutation arguments", () => {
  const collectionIds = collectCollectionIds(undefined, {
    collectionId: "collection-1",
  });

  assert.deepEqual(collectionIds, ["collection-1"]);
});

test("collectCollectionIds deduplicates ids supplied by multiple argument shapes", () => {
  const collectionIds = collectCollectionIds(undefined, {
    where: { id: "collection-1" },
    input: { collectionId: "collection-1" },
  });

  assert.deepEqual(collectionIds, ["collection-1"]);
});
