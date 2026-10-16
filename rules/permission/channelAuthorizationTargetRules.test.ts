import assert from "node:assert/strict";
import test from "node:test";
import { canArchiveAndUnarchiveComment } from "./canArchiveAndUnarchiveComment.js";
import { canArchiveAndUnarchiveDiscussion } from "./canArchiveAndUnarchiveDiscussion.js";
import { canArchiveAndUnarchiveEvent } from "./canArchiveAndUnarchiveEvent.js";
import { canSuspendAndUnsuspendUser } from "./canSuspendAndUnsuspendUser.js";
import { ERROR_MESSAGES } from "../errorMessages.js";

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

test("archive-event resolves its channel through the issue repository", async () => {
  const { calls, context, jwtError } = makeContext();

  assert.equal(
    await run(
      canArchiveAndUnarchiveEvent,
      { issueId: "issue-1" },
      context
    ),
    jwtError
  );
  assert.deepEqual(calls, ["issue:issue-1"]);
});

const makeSuspendContext = (input: {
  issueFound?: boolean;
  channelAdmins?: string[] | null;
}) => {
  const issueCalls: string[] = [];
  const channelCalls: string[] = [];
  const jwtError = new Error("permission check reached");
  const channelAdmins = input.channelAdmins ?? [];
  const context = {
    driver: {},
    ogm: {},
    jwtError,
    user: {
      username: "alice",
      email: "alice@example.test",
      email_verified: true,
      data: { ModerationProfile: null },
    },
    permissionServerConfigRepository: {
      findByName: async () => ({
        Admins: [],
        SuperAdmins: [],
        Moderators: [],
        SuspendedUsers: [],
        SuspendedMods: [],
      }),
    },
    contentChannelPermissionRepository: {
      findCommentChannels: async () => ({ found: false, channelUniqueNames: [] }),
      findDiscussionChannels: async () => ({ found: false, channelUniqueNames: [] }),
      findEventChannels: async () => ({ found: false, channelUniqueNames: [] }),
      findIssueChannel: async (id: string) => {
        issueCalls.push(id);
        return input.issueFound === false
          ? { found: false, channelUniqueName: null }
          : { found: true, channelUniqueName: "cats" };
      },
      findCommentChannelReferences: async () => ({
        found: false,
        discussionChannelUniqueName: null,
        directChannelUniqueName: null,
      }),
    },
    channelPermissionRepository: {
      findAuthorizationSnapshot: async (uniqueName: string) => {
        channelCalls.push(uniqueName);
        if (input.channelAdmins === null) return null;
        return {
          Admins: channelAdmins.map((username) => ({ username })),
          Moderators: [],
          DefaultChannelRole: null,
          ElevatedChannelRole: null,
          SuspendedRole: null,
          DefaultModRole: null,
          ElevatedModRole: null,
          SuspendedModRole: null,
        };
      },
      findTargetedSuspensions: async () => ({
        userSuspensions: [],
        modSuspensions: [],
      }),
    },
  };

  return { context, issueCalls, channelCalls, jwtError };
};

test("suspension resolves issue channels and protects channel owners", async () => {
  const { context, issueCalls, channelCalls } = makeSuspendContext({
    channelAdmins: ["target"],
  });

  const result = await run(
    canSuspendAndUnsuspendUser,
    { issueId: "issue-1", username: "target" },
    context
  );
  assert.ok(result instanceof Error);
  assert.equal(result.message, ERROR_MESSAGES.channel.cantSuspendOwner);
  assert.deepEqual(issueCalls, ["issue-1"]);
  assert.deepEqual(channelCalls, ["cats"]);
});

test("suspension preserves missing issue and missing channel behavior", async () => {
  const missingIssue = makeSuspendContext({
    issueFound: false,
    channelAdmins: [],
  });
  const issueResult = await run(
    canSuspendAndUnsuspendUser,
    { issueId: "missing", username: "target" },
    missingIssue.context
  );
  assert.ok(issueResult instanceof Error);
  assert.equal(
    issueResult.message,
    "Could not find the issue or its associated channel."
  );
  assert.deepEqual(missingIssue.channelCalls, []);

  const missingChannel = makeSuspendContext({ channelAdmins: null });
  assert.equal(
    await run(
      canSuspendAndUnsuspendUser,
      { channelUniqueName: "missing", username: "target" },
      missingChannel.context
    ),
    missingChannel.jwtError
  );
  assert.deepEqual(missingChannel.channelCalls, ["missing"]);
});
