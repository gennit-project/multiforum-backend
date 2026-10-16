import assert from "node:assert/strict";
import test from "node:test";
import { canArchiveAndUnarchiveComment } from "./canArchiveAndUnarchiveComment.js";
import { canArchiveAndUnarchiveDiscussion } from "./canArchiveAndUnarchiveDiscussion.js";

const run = (permissionRule: any, args: unknown, ctx: unknown) =>
  permissionRule.func({}, args, ctx, {} as any);

const makeContext = () => {
  const calls: string[] = [];
  const jwtError = new Error("permission check reached");
  return {
    calls,
    context: {
      driver: {},
      ogm: {},
      jwtError,
      contentChannelPermissionRepository: {
        findCommentChannels: async () => ({ found: false, channelUniqueNames: [] }),
        findDiscussionChannels: async () => ({ found: false, channelUniqueNames: [] }),
        findEventChannels: async () => ({ found: false, channelUniqueNames: [] }),
        findIssueChannel: async (id: string) => {
          calls.push(`issue:${id}`);
          return { found: true, channelUniqueName: "issue-channel" };
        },
        findCommentChannelReferences: async (id: string) => {
          calls.push(`comment:${id}`);
          return {
            found: true,
            discussionChannelUniqueName: "discussion-channel",
            directChannelUniqueName: "direct-channel",
          };
        },
      },
    },
    jwtError,
  };
};

test("archive-comment resolves issue then direct comment channel", async () => {
  const { calls, context, jwtError } = makeContext();

  assert.equal(
    await run(
      canArchiveAndUnarchiveComment,
      { issueId: "issue-1", commentId: "comment-1" },
      context
    ),
    jwtError
  );
  assert.deepEqual(calls, ["issue:issue-1", "comment:comment-1"]);
});

test("direct channels skip target lookups", async () => {
  const { calls, context, jwtError } = makeContext();

  assert.equal(
    await run(
      canArchiveAndUnarchiveDiscussion,
      { channelUniqueName: "direct", issueId: "issue-1" },
      context
    ),
    jwtError
  );
  assert.deepEqual(calls, []);
});
