import test from "node:test";
import assert from "node:assert/strict";
import {
  getAttemptedImageVariantFields,
  imageVariantFieldsError,
} from "./variantFieldUpdates.js";

test("returns no attempted image variant fields for ordinary image updates", () => {
  assert.deepEqual(
    getAttemptedImageVariantFields({
      alt: "Alt text",
      caption: "Caption",
    }),
    []
  );
});

test("detects attempted image variant field updates", () => {
  assert.deepEqual(
    getAttemptedImageVariantFields({
      variantUrls: { list320: "https://img.test/list-320.webp" },
      list320Url: "https://img.test/direct-list-320.webp",
      detail640Url: "https://img.test/detail-640.webp",
    }),
    ["variantUrls", "list320Url", "detail640Url"]
  );
});

test("formats a useful image variant field error", () => {
  assert.equal(
    imageVariantFieldsError(["variantUrls", "detail960Url"]),
    "Image variant fields cannot be assigned through image updates (variantUrls, detail960Url). They are managed by backend image processing."
  );
});
