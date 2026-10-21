import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type {
  ContentChannelLookup,
  ContentChannelPermissionRepository,
} from "../../services/persistence/contentChannelPermissionRepository.js";
import { canEditCommentsHandler } from "./canEditComments.js";
import { canEditDiscussionsHandler } from "./canEditDiscussions.js";
import { canEditEventsHandler } from "./canEditEvents.js";
import { canStickyCommentHandler } from "./canStickyComment.js";

const found = (channelUniqueNames: string[]): ContentChannelLookup => ({
  found: true,
  channelUniqueNames,
});

const missing: ContentChannelLookup = {
  found: false,
  channelUniqueNames: [],
};

const unusedSingleLookups = {
  async findIssueChannel() {
    return { found: false, channelUniqueName: null };
  },
  async findCommentChannelReferences() {
    return {
      found: false,
      discussionChannelUniqueName: null,
      directChannelUniqueName: null,
    };
  },
  async findDiscussionChannelReference() {
    return { found: false, channelUniqueName: null };
  },
};

const makeContext = (
  repository: ContentChannelPermissionRepository,
  jwtError?: Error
): GraphQLContext => ({
  driver: {} as Driver,
  contentChannelPermissionRepository: repository,
  jwtError,
});

test("content permission handlers reject missing identifiers before querying", async () => {
  let repositoryCalls = 0;
  const repository: ContentChannelPermissionRepository = {
    ...unusedSingleLookups,
    async findCommentChannels() {
      repositoryCalls += 1;
      return missing;
    },
    async findDiscussionChannels() {
      repositoryCalls += 1;
      return missing;
    },
    async findEventChannels() {
      repositoryCalls += 1;
      return missing;
    },
  };
  const context = makeContext(repository);

  assert.equal(
    (await canEditCommentsHandler(undefined, {}, context) as Error).message,
    "No comment specified for this operation."
  );
  assert.equal(
    (await canEditDiscussionsHandler(undefined, {}, context) as Error).message,
    "No discussion specified for this operation."
  );
  assert.equal(
    (await canEditEventsHandler(undefined, {}, context) as Error).message,
    "No event specified for this operation."
  );
  assert.equal(
    (await canStickyCommentHandler(undefined, {}, context) as Error).message,
    "No comment specified for this operation."
  );
  assert.equal(repositoryCalls, 0);
});

test("content permission handlers pass every supported identifier to the repository", async () => {
  const commentCalls: string[][] = [];
  const discussionCalls: string[][] = [];
  const eventCalls: string[][] = [];
  const repository: ContentChannelPermissionRepository = {
    ...unusedSingleLookups,
    async findCommentChannels(ids) {
      commentCalls.push(ids);
      return found(["cats"]);
    },
    async findDiscussionChannels(ids) {
      discussionCalls.push(ids);
      return found(["dogs"]);
    },
    async findEventChannels(ids) {
      eventCalls.push(ids);
      return found(["events"]);
    },
  };
  const permissionError = new Error("expired token");
  const context = makeContext(repository, permissionError);

  assert.equal(
    await canEditCommentsHandler(
      undefined,
      {
        commentId: "comment-argument",
        where: {
          id: "comment-where",
          id_IN: ["comment-list-1", "comment-list-2"],
        },
      },
      context
    ),
    permissionError
  );
  assert.equal(
    await canEditDiscussionsHandler(
      undefined,
      {
        discussionId: "discussion-argument",
        where: {
          id: "discussion-where",
          id_IN: ["discussion-list"],
        },
      },
      context
    ),
    permissionError
  );
  assert.equal(
    await canEditEventsHandler(
      undefined,
      {
        eventId: "event-argument",
        where: { id: "event-where", id_IN: ["event-list"] },
      },
      context
    ),
    permissionError
  );
  assert.equal(
    await canStickyCommentHandler(
      undefined,
      { commentId: "sticky-comment" },
      context
    ),
    permissionError
  );

  assert.deepEqual(commentCalls, [
    [
      "comment-argument",
      "comment-where",
      "comment-list-1",
      "comment-list-2",
    ],
    ["sticky-comment"],
  ]);
  assert.deepEqual(discussionCalls, [
    ["discussion-argument", "discussion-where", "discussion-list"],
  ]);
  assert.deepEqual(eventCalls, [
    ["event-argument", "event-where", "event-list"],
  ]);
});

test("content permission handlers preserve not-found and no-channel errors", async () => {
  const repository: ContentChannelPermissionRepository = {
    ...unusedSingleLookups,
    async findCommentChannels(ids) {
      return ids[0] === "orphan-comment" ? found([]) : missing;
    },
    async findDiscussionChannels() {
      return found([]);
    },
    async findEventChannels() {
      return missing;
    },
  };
  const context = makeContext(repository);

  assert.equal(
    (
      await canEditCommentsHandler(
        undefined,
        { commentId: "missing-comment" },
        context
      ) as Error
    ).message,
    "Could not find the comment or its associated channel."
  );
  assert.equal(
    (
      await canStickyCommentHandler(
        undefined,
        { commentId: "orphan-comment" },
        context
      ) as Error
    ).message,
    "No channel specified for this operation."
  );
  assert.equal(
    (
      await canEditDiscussionsHandler(
        undefined,
        { discussionId: "orphan-discussion" },
        context
      ) as Error
    ).message,
    "No channel specified for this operation."
  );
  assert.equal(
    (
      await canEditEventsHandler(
        undefined,
        { eventId: "missing-event" },
        context
      ) as Error
    ).message,
    "Could not find the event or its associated channel."
  );
});
