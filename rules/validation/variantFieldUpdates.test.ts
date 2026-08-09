import test from "node:test";
import assert from "node:assert/strict";
import {
  eventVariantFieldsError,
  getAttemptedEventVariantFields,
  getAttemptedImageVariantFields,
  getAttemptedUserVariantFields,
  imageVariantFieldsError,
  userVariantFieldsError,
} from "./variantFieldUpdates.js";

test("returns no attempted user variant fields for ordinary user updates", () => {
  assert.deepEqual(
    getAttemptedUserVariantFields({
      bio: "hi",
      displayName: "Alice",
    }),
    []
  );
});

test("detects attempted user variant field updates", () => {
  assert.deepEqual(
    getAttemptedUserVariantFields({
      variantUrls: { avatar32: "https://img.test/avatar-32.webp" },
      avatar96Url: "https://img.test/avatar-96.webp",
    }),
    ["variantUrls", "avatar96Url"]
  );
});

test("formats a useful user variant field error", () => {
  assert.equal(
    userVariantFieldsError(["variantUrls", "avatar96Url"]),
    "Image variant fields cannot be assigned through updateUsers (variantUrls, avatar96Url). They are managed by backend image processing."
  );
});

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
    imageVariantFieldsError(["width", "variantUrls", "detail960Url"]),
    "Backend-managed image fields cannot be assigned through image updates (width, variantUrls, detail960Url). They are managed by backend image processing."
  );
});

test("returns no attempted event variant fields for ordinary event updates", () => {
  assert.deepEqual(
    getAttemptedEventVariantFields({
      title: "Meetup",
      description: "Fun",
    }),
    []
  );
});

test("detects attempted event variant field updates", () => {
  assert.deepEqual(
    getAttemptedEventVariantFields({
      variantUrls: { list320: "https://img.test/list-320.webp" },
    }),
    ["variantUrls"]
  );
});

test("formats a useful event variant field error", () => {
  assert.equal(
    eventVariantFieldsError(["variantUrls"]),
    "Image variant fields cannot be assigned through event updates (variantUrls). They are managed by backend image processing."
  );
});
