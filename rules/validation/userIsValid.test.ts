import test from "node:test";
import assert from "node:assert/strict";
import { validateUserInput } from "./userIsValid.js";
import {
  MAX_CHARS_IN_USERNAME,
  MAX_CHARS_IN_USER_BIO,
  MAX_CHARS_IN_USER_DISPLAY_NAME,
} from "./constants.js";

test("accepts a valid create input", () => {
  assert.equal(
    validateUserInput({ username: "alice", isEditMode: false }),
    true
  );
});

test("requires a username on create", () => {
  assert.equal(
    validateUserInput({ username: "", isEditMode: false }),
    "A username is required."
  );
});

test("does not require a username in edit mode", () => {
  assert.equal(validateUserInput({ bio: "hello", isEditMode: true }), true);
});

test("rejects a username over the length limit", () => {
  const username = "a".repeat(MAX_CHARS_IN_USERNAME + 1);
  assert.equal(
    validateUserInput({ username, isEditMode: false }),
    `The username cannot exceed ${MAX_CHARS_IN_USERNAME} characters.`
  );
});

test("accepts a username exactly at the length limit", () => {
  const username = "a".repeat(MAX_CHARS_IN_USERNAME);
  assert.equal(validateUserInput({ username, isEditMode: false }), true);
});

test("rejects usernames with spaces or special characters", () => {
  for (const username of ["has space", "has-dash", "a.b", "emoji😀"]) {
    const result = validateUserInput({ username, isEditMode: false });
    assert.match(
      result as string,
      /can only contain letters, numbers, and underscores/
    );
  }
});

test("rejects a bio over the length limit", () => {
  const bio = "a".repeat(MAX_CHARS_IN_USER_BIO + 1);
  assert.equal(
    validateUserInput({ username: "alice", bio, isEditMode: false }),
    `The user bio cannot exceed ${MAX_CHARS_IN_USER_BIO} characters.`
  );
});

test("rejects a display name over the length limit", () => {
  const displayName = "a".repeat(MAX_CHARS_IN_USER_DISPLAY_NAME + 1);
  assert.equal(
    validateUserInput({ username: "alice", displayName, isEditMode: false }),
    `The display name cannot exceed ${MAX_CHARS_IN_USER_DISPLAY_NAME} characters.`
  );
});

test("validates bio and display name length even in edit mode", () => {
  const bio = "a".repeat(MAX_CHARS_IN_USER_BIO + 1);
  assert.equal(
    validateUserInput({ bio, isEditMode: true }),
    `The user bio cannot exceed ${MAX_CHARS_IN_USER_BIO} characters.`
  );
});
