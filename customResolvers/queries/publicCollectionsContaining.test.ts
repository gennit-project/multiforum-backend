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
