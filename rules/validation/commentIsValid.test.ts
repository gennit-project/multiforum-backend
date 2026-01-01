import assert from "node:assert/strict";
import { validateCreateCommentInput } from "./commentIsValid.js";
import { MAX_CHARS_IN_COMMENT_TEXT } from "./constants.js";
import type { CommentCreateInput } from "../../src/generated/graphql.js";

const baseInput = (): CommentCreateInput => ({
  isRootComment: true,
  text: "hello",
  Channel: {
    connect: {
      where: {
        node: {
          uniqueName: "cats",
        },
      },
    },
  },
  CommentAuthor: {
    User: {
      connect: {
        where: {
          node: {
            username: "alex",
          },
        },
      },
    },
  },
});

async function testMissingChannel() {
  const input = baseInput();
  delete input.Channel;
  const result = validateCreateCommentInput(input);
  assert.equal(result, "Comment must be attached to a channel.");
}

async function testMissingAuthor() {
  const input = baseInput();
  delete input.CommentAuthor;
  const result = validateCreateCommentInput(input);
  assert.equal(result, "Comment author is required.");
}

async function testMissingText() {
  const input = baseInput();
  input.text = "";
  const result = validateCreateCommentInput(input);
  assert.equal(result, "Comment text is required.");
}

async function testTooLongText() {
  const input = baseInput();
  input.text = "a".repeat(MAX_CHARS_IN_COMMENT_TEXT + 1);
  const result = validateCreateCommentInput(input);
  assert.equal(
    result,
    `The comment text cannot exceed ${MAX_CHARS_IN_COMMENT_TEXT} characters.`
  );
}

async function testValidInput() {
  const input = baseInput();
  const result = validateCreateCommentInput(input);
  assert.equal(result, true);
}

async function run() {
  await testMissingChannel();
  await testMissingAuthor();
  await testMissingText();
  await testTooLongText();
  await testValidInput();
  console.log("commentIsValid tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
