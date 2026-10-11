import assert from "node:assert/strict";
import test from "node:test";
import { assertValidUploadSelections } from "./validateDownloadLabelSelections.js";

const label = (id: string, groupId: string, uploadSelection: "SINGLE" | "MULTIPLE" | null) => ({
  id,
  displayName: id,
  value: id,
  group: {
    id: groupId,
    key: groupId,
    displayName: groupId,
    uploadSelection,
  },
});

test("allows multiple selected labels in a multiple-choice group", () => {
  assert.doesNotThrow(() =>
    assertValidUploadSelections([
      label("first", "formats", "MULTIPLE"),
      label("second", "formats", "MULTIPLE"),
    ])
  );
});

test("treats a missing selection mode as multiple for legacy groups", () => {
  assert.doesNotThrow(() =>
    assertValidUploadSelections([
      label("first", "formats", null),
      label("second", "formats", null),
    ])
  );
});

test("rejects multiple selected labels in a single-choice group", () => {
  assert.throws(
    () =>
      assertValidUploadSelections([
        label("small", "Size", "SINGLE"),
        label("large", "Size", "SINGLE"),
      ]),
    (error: unknown) => {
      assert.equal((error as { extensions?: { code?: string } }).extensions?.code, "BAD_USER_INPUT");
      assert.match((error as Error).message, /Size.*only one label/);
      return true;
    }
  );
});

test("allows one selected label in each single-choice group", () => {
  assert.doesNotThrow(() =>
    assertValidUploadSelections([
      label("small", "Size", "SINGLE"),
      label("cheap", "Price", "SINGLE"),
    ])
  );
});
