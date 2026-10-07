import assert from "node:assert/strict";
import test from "node:test";
import { getFinalCommentText } from "./reportText.js";

test("getFinalCommentText labels forum and server rules correctly", () => {
  const result = getFinalCommentText({
    selectedForumRules: ["Be constructive"],
    selectedServerRules: ["No spam"],
    reportText: "Additional context",
  });

  assert.equal(
    result,
    "\nForum rule violations: Be constructive\n\nServer rule violations: No spam\n\nAdditional context\n\n"
  );
});
