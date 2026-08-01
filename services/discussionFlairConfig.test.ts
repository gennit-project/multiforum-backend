import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscussionFlairConfig } from "./discussionFlairConfig.js";

test("normalizes flair names and colors", () => {
  assert.deepEqual(
    normalizeDiscussionFlairConfig(
      [
        {
          displayName: "  Project   Update  ",
          color: "#2563eb",
          order: 0,
        },
      ],
      true
    ),
    [
      {
        id: undefined,
        displayName: "Project Update",
        color: "#2563EB",
        order: 0,
        archived: false,
      },
    ]
  );
});

test("allows no active flairs when flair is optional", () => {
  assert.deepEqual(normalizeDiscussionFlairConfig([], false), []);
});

test("requires an active flair before enabling the requirement", () => {
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [
          {
            id: "archived-flair",
            displayName: "Archived",
            order: 0,
            archived: true,
          },
        ],
        true
      ),
    /At least one active flair/
  );
});

test("rejects duplicate active names case-insensitively", () => {
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [
          { displayName: "Question", order: 0 },
          { displayName: " question ", order: 1 },
        ],
        false
      ),
    /Active flair names must be unique/
  );
});

test("rejects duplicate IDs and active order values", () => {
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [
          { id: "same", displayName: "One", order: 0 },
          { id: "same", displayName: "Two", order: 1 },
        ],
        false
      ),
    /Duplicate flair ID/
  );

  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [
          { displayName: "One", order: 0 },
          { displayName: "Two", order: 0 },
        ],
        false
      ),
    /Active flair order values must be unique/
  );
});

test("rejects invalid names, colors, and order values", () => {
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [{ displayName: " ", order: 0 }],
        false
      ),
    /must have a display name/
  );
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [{ displayName: "Question", color: "blue", order: 0 }],
        false
      ),
    /six-digit hexadecimal/
  );
  assert.throws(
    () =>
      normalizeDiscussionFlairConfig(
        [{ displayName: "Question", order: -1 }],
        false
      ),
    /non-negative integer/
  );
});
