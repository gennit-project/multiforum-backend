import assert from "node:assert/strict";
import test from "node:test";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { isAlbumOwner } from "./isAlbumOwner.js";
import { isCollectionOwner } from "./isCollectionOwner.js";
import { isCommentAuthor } from "./isCommentAuthor.js";
import { isDiscussionOwner } from "./isDiscussionOwner.js";
import { isEventOwner } from "./isEventOwner.js";
import { isImageUploader } from "./isImageUploader.js";
import { isIssueAuthor } from "./isIssueAuthor.js";
import { issueIsNotLocked } from "./issueIsNotLocked.js";

const run = (permissionRule: any, args: unknown, ctx: unknown, parent = {}) =>
  permissionRule.func(parent, args, ctx, {} as any);

const makeContext = (repositoryOverrides: Record<string, unknown> = {}) => ({
  user: {
    username: "alice",
    email: "alice@example.test",
    email_verified: true,
    data: { ModerationProfile: { displayName: "Mod A" } },
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
  contentAuthorizationRepository: {
    findAlbumOwners: async (ids: string[]) =>
      ids.map((id) => ({ id, username: "alice" })),
    findCollectionOwners: async (ids: string[]) =>
      ids.map((id) => ({ id, username: "alice" })),
    findCommentAuthor: async () => ({
      found: true,
      actor: { username: "alice", displayName: null },
    }),
    findDiscussionAuthor: async () => ({ found: true, username: "alice" }),
    findEventPoster: async () => ({ found: true, username: "alice" }),
    findImageUploader: async () => ({ found: true, username: "alice" }),
    findIssueAuthor: async () => ({
      found: true,
      actor: { username: "alice", displayName: null },
    }),
    findIssueLock: async () => ({ found: true, locked: false }),
    ...repositoryOverrides,
  },
  driver: {},
  ogm: {},
  req: { headers: {} },
});

test("album ownership requires every requested album to exist and match", async () => {
  assert.equal(
    await run(
      isAlbumOwner,
      { where: { id_IN: ["album-1", "album-2"] } },
      makeContext()
    ),
    true
  );

  await assert.rejects(
    run(
      isAlbumOwner,
      { where: { id_IN: ["album-1", "missing"] } },
      makeContext({
        findAlbumOwners: async () => [
          { id: "album-1", username: "alice" },
        ],
      })
    ),
    { message: ERROR_MESSAGES.album.notFound }
  );
  await assert.rejects(
    run(
      isAlbumOwner,
      { where: { id: "album-1" } },
      makeContext({
        findAlbumOwners: async () => [
          { id: "album-1", username: "mallory" },
        ],
      })
    ),
    { message: ERROR_MESSAGES.album.notOwner }
  );
});

test("collection ownership preserves multi-id not-found and not-owner errors", async () => {
  assert.equal(
    await run(
      isCollectionOwner,
      { where: { id_IN: ["collection-1", "collection-2"] } },
      makeContext()
    ),
    true
  );
  await assert.rejects(
    run(
      isCollectionOwner,
      { collectionId: "collection-1" },
      makeContext({ findCollectionOwners: async () => [] })
    ),
    { message: ERROR_MESSAGES.collection.notFound }
  );
  await assert.rejects(
    run(
      isCollectionOwner,
      { collectionId: "collection-1" },
      makeContext({
        findCollectionOwners: async () => [
          { id: "collection-1", username: null },
        ],
      })
    ),
    { message: ERROR_MESSAGES.collection.notOwner }
  );
});

test("comment authors may match by username or moderation profile", async () => {
  assert.equal(
    await run(
      isCommentAuthor,
      { where: { id: "comment-1" } },
      makeContext()
    ),
    true
  );
  assert.equal(
    await run(
      isCommentAuthor,
      { where: { id: "comment-1" } },
      makeContext({
        findCommentAuthor: async () => ({
          found: true,
          actor: { username: null, displayName: "Mod A" },
        }),
      })
    ),
    true
  );
  assert.equal(
    await run(
      isCommentAuthor,
      { where: { id: "comment-1" } },
      makeContext({
        findCommentAuthor: async () => ({
          found: true,
          actor: { username: "mallory", displayName: null },
        }),
      })
    ),
    false
  );
  await assert.rejects(
    run(
      isCommentAuthor,
      { where: { id: "comment-1" } },
      makeContext({
        findCommentAuthor: async () => ({ found: true, actor: null }),
      })
    ),
    { message: ERROR_MESSAGES.comment.noOwner }
  );
});

test("discussion and event ownership preserve missing-owner behavior", async () => {
  assert.equal(
    await run(isDiscussionOwner, { where: { id: "discussion-1" } }, makeContext()),
    true
  );
  assert.equal(
    await run(
      isEventOwner,
      { where: { id: "event-1" } },
      makeContext({
        findEventPoster: async () => ({ found: true, username: "mallory" }),
      })
    ),
    false
  );
  await assert.rejects(
    run(
      isDiscussionOwner,
      { where: { id: "discussion-1" } },
      makeContext({
        findDiscussionAuthor: async () => ({ found: true, username: null }),
      })
    ),
    { message: ERROR_MESSAGES.discussion.noAuthor }
  );
  await assert.rejects(
    run(
      isEventOwner,
      { where: { id: "event-1" } },
      makeContext({ findEventPoster: async () => ({ found: false, username: null }) })
    ),
    { message: ERROR_MESSAGES.event.notFound }
  );
});

test("legacy images without an uploader remain editable", async () => {
  assert.equal(
    await run(
      isImageUploader,
      { where: { id: "image-1" } },
      makeContext({
        findImageUploader: async () => ({ found: true, username: null }),
      })
    ),
    true
  );
  assert.equal(
    await run(
      isImageUploader,
      { where: { id: "image-1" } },
      makeContext({
        findImageUploader: async () => ({ found: true, username: "mallory" }),
      })
    ),
    false
  );
});

test("issue authors may match by username or moderation profile", async () => {
  assert.equal(
    await run(isIssueAuthor, { where: { id: "issue-1" } }, makeContext()),
    true
  );
  assert.equal(
    await run(
      isIssueAuthor,
      { where: { id: "issue-1" } },
      makeContext({
        findIssueAuthor: async () => ({
          found: true,
          actor: { username: null, displayName: "Mod A" },
        }),
      })
    ),
    true
  );
  assert.equal(
    await run(
      isIssueAuthor,
      { where: { id: "issue-1" } },
      makeContext({
        findIssueAuthor: async () => ({
          found: true,
          actor: { username: null, displayName: "Mod B" },
        }),
      })
    ),
    false
  );
});

test("issue lock checks deny only explicitly locked issues", async () => {
  assert.equal(
    await run(issueIsNotLocked, { where: { id: "issue-1" } }, makeContext()),
    true
  );
  assert.equal(
    await run(
      issueIsNotLocked,
      { where: { id: "issue-1" } },
      makeContext({
        findIssueLock: async () => ({ found: true, locked: true }),
      })
    ),
    false
  );
  await assert.rejects(
    run(
      issueIsNotLocked,
      { where: { id: "missing" } },
      makeContext({
        findIssueLock: async () => ({ found: false, locked: null }),
      })
    ),
    { message: ERROR_MESSAGES.issue.notFound }
  );
});
