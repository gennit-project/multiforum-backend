import test from "node:test";
import assert from "node:assert/strict";
import { validateChannelInput } from "./channelIsValid.js";
import {
  MAX_CHARS_IN_CHANNEL_NAME,
  MAX_CHARS_IN_CHANNEL_DESCRIPTION,
  MAX_CHARS_IN_DISPLAY_NAME,
} from "./constants.js";

test("accepts a valid create input", () => {
  assert.equal(
    validateChannelInput({ uniqueName: "cats", isEditMode: false }),
    true
  );
});

test("requires a unique name on create", () => {
  assert.equal(
    validateChannelInput({ uniqueName: "", isEditMode: false }),
    "A unique name is required."
  );
});

test("does not require a unique name in edit mode", () => {
  assert.equal(
    validateChannelInput({ description: "updated", isEditMode: true }),
    true
  );
});

test("rejects a unique name over the length limit", () => {
  const uniqueName = "a".repeat(MAX_CHARS_IN_CHANNEL_NAME + 1);
  assert.equal(
    validateChannelInput({ uniqueName, isEditMode: false }),
    `The unique name cannot exceed ${MAX_CHARS_IN_CHANNEL_NAME} characters.`
  );
});

test("accepts a unique name exactly at the length limit", () => {
  const uniqueName = "a".repeat(MAX_CHARS_IN_CHANNEL_NAME);
  assert.equal(validateChannelInput({ uniqueName, isEditMode: false }), true);
});

test("rejects unique names with spaces or special characters", () => {
  for (const uniqueName of ["has space", "has-dash", "emoji😀", "dot.dot"]) {
    const result = validateChannelInput({ uniqueName, isEditMode: false });
    assert.match(
      result as string,
      /can only contain letters, numbers, and underscores/
    );
  }
});

test("allows underscores and digits in the unique name", () => {
  assert.equal(
    validateChannelInput({ uniqueName: "cool_cats_42", isEditMode: false }),
    true
  );
});

test("rejects a description over the length limit", () => {
  const description = "a".repeat(MAX_CHARS_IN_CHANNEL_DESCRIPTION + 1);
  assert.equal(
    validateChannelInput({ uniqueName: "cats", description, isEditMode: false }),
    `The description text cannot exceed ${MAX_CHARS_IN_CHANNEL_DESCRIPTION} characters.`
  );
});

test("rejects a display name over the length limit", () => {
  const displayName = "a".repeat(MAX_CHARS_IN_DISPLAY_NAME + 1);
  assert.equal(
    validateChannelInput({ uniqueName: "cats", displayName, isEditMode: false }),
    `The display name cannot exceed ${MAX_CHARS_IN_DISPLAY_NAME} characters.`
  );
});

test("accepts a valid rules JSON array", () => {
  const rules = JSON.stringify([{ summary: "Be kind", detail: "..." }]);
  assert.equal(
    validateChannelInput({ uniqueName: "cats", rules, isEditMode: false }),
    true
  );
});

test("rejects rules that are not a JSON array", () => {
  const rules = JSON.stringify({ summary: "Be kind" });
  assert.equal(
    validateChannelInput({ uniqueName: "cats", rules, isEditMode: false }),
    "The rules must be an array."
  );
});

test("rejects a rule missing a summary", () => {
  const rules = JSON.stringify([{ detail: "no summary here" }]);
  assert.equal(
    validateChannelInput({ uniqueName: "cats", rules, isEditMode: false }),
    "Each rule must have a summary."
  );
});

test("rejects malformed rules JSON", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      rules: "{not valid json",
      isEditMode: false,
    }),
    "The rules must be a valid JSON array."
  );
});

// --- preference flags (#105) ---

test("accepts boolean preference flags", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      eventsEnabled: false,
      wikiEnabled: true,
      isEditMode: false,
    }),
    true
  );
});

test("accepts null/undefined preference flags", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      eventsEnabled: null,
      isEditMode: false,
    }),
    true
  );
});

test("rejects a non-boolean preference flag", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      // @ts-expect-error - deliberately invalid value
      eventsEnabled: "yes",
      isEditMode: false,
    }),
    "eventsEnabled must be true or false."
  );
});

test("accepts a valid allowedFileTypes array", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      allowedFileTypes: ["pdf", ".png", "STL"],
      isEditMode: false,
    }),
    true
  );
});

test("rejects allowedFileTypes that is not an array", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      // @ts-expect-error - deliberately invalid value
      allowedFileTypes: "pdf",
      isEditMode: false,
    }),
    "allowedFileTypes must be an array."
  );
});

test("rejects an empty-string file type", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      allowedFileTypes: ["pdf", "  "],
      isEditMode: false,
    }),
    "Each allowed file type must be a non-empty string."
  );
});

test("rejects a malformed file type", () => {
  assert.equal(
    validateChannelInput({
      uniqueName: "cats",
      allowedFileTypes: ["pdf/exe"],
      isEditMode: false,
    }),
    '"pdf/exe" is not a valid file type.'
  );
});
