import test from "node:test";
import assert from "node:assert/strict";
import { commentVersionHistoryHandler } from "../hooks/commentVersionHistoryHook.js";
import { discussionEditNotificationHandler } from "../hooks/discussionVersionHistoryHook.js";

const buildUserModel = () => {
  const updates: Array<any> = [];
  return {
    updates,
    model: {
      update: async (input: any) => {
        updates.push(input);
        return { users: [{ username: input?.where?.username || "" }] };
      },
      find: async () => [{ username: "modUser" }],
    },
  };
};

const buildCommentModels = (userModel: any) => {
  return {
    CommentModel: {
      find: async () => [{ id: "comment-1" }],
      update: async () => ({ comments: [{ id: "comment-1" }] }),
    },
    TextVersionModel: {
      create: async () => ({ textVersions: [{ id: "tv-1" }] }),
    },
    UserModel: userModel,
    IssueModel: {
      find: async () => [],
    },
  };
};

test("comment edit by mod notifies OP", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const { model: UserModel, updates } = buildUserModel();
  const { CommentModel, TextVersionModel, IssueModel } = buildCommentModels(UserModel);

  const context = {
    user: {
      username: "modUser",
      data: {
        ModerationProfile: { displayName: "Mod A" },
      },
    },
    ogm: {
      model: (name: string) => {
        if (name === "Comment") return CommentModel;
        if (name === "TextVersion") return TextVersionModel;
        if (name === "User") return UserModel;
        if (name === "Issue") return IssueModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await commentVersionHistoryHandler({
    context,
    params: { where: { id: "comment-1" }, update: { text: "new text" } },
    commentSnapshot: {
      id: "comment-1",
      text: "old text",
      CommentAuthor: { username: "opUser" },
      DiscussionChannel: {
        discussionId: "discussion-1",
        channelUniqueName: "test_forum",
        Discussion: { id: "discussion-1", title: "Test Discussion" },
      },
      PastVersions: [],
    },
  });

  assert.equal(updates.length, 1);
  const notification = updates[0];
  assert.equal(notification.where.username, "opUser");
  const notificationText =
    notification.update.Notifications[0].create[0].node.text;
  assert.match(notificationText, /Mod A edited your comment/);
  assert.match(
    notificationText,
    /\[Test Discussion\]\(https:\/\/example\.com\/forums\/test_forum\/discussions\/discussion-1\/comments\/comment-1\)/
  );
});

test("comment edit by OP does not notify", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const { model: UserModel, updates } = buildUserModel();
  const { CommentModel, TextVersionModel, IssueModel } = buildCommentModels(UserModel);

  const context = {
    user: {
      username: "opUser",
    },
    ogm: {
      model: (name: string) => {
        if (name === "Comment") return CommentModel;
        if (name === "TextVersion") return TextVersionModel;
        if (name === "User") return UserModel;
        if (name === "Issue") return IssueModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await commentVersionHistoryHandler({
    context,
    params: { where: { id: "comment-2" }, update: { text: "new text" } },
    commentSnapshot: {
      id: "comment-2",
      text: "old text",
      CommentAuthor: { username: "opUser" },
      DiscussionChannel: {
        discussionId: "discussion-2",
        channelUniqueName: "test_forum",
        Discussion: { id: "discussion-2", title: "Test Discussion" },
      },
      PastVersions: [],
    },
  });

  assert.equal(updates.length, 0);
});

test("discussion edit by mod notifies OP", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const { model: UserModel, updates } = buildUserModel();

  const context = {
    user: {
      username: "modUser",
      data: {
        ModerationProfile: { displayName: "Mod A" },
      },
    },
    ogm: {
      model: (name: string) => {
        if (name === "User") return UserModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "discussion-3" }, update: { title: "New Title" } },
    discussionSnapshot: {
      id: "discussion-3",
      title: "Old Title",
      body: "Body",
      Author: { username: "opUser" },
      DiscussionChannels: [{ channelUniqueName: "test_forum" }],
    },
  });

  assert.equal(updates.length, 1);
  const notification = updates[0];
  assert.equal(notification.where.username, "opUser");
  const notificationText =
    notification.update.Notifications[0].create[0].node.text;
  assert.match(notificationText, /Mod A edited your discussion/);
  assert.match(
    notificationText,
    /\[Old Title\]\(https:\/\/example\.com\/forums\/test_forum\/discussions\/discussion-3\)/
  );
});

test("discussion edit by OP does not notify", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const { model: UserModel, updates } = buildUserModel();

  const context = {
    user: {
      username: "opUser",
    },
    ogm: {
      model: (name: string) => {
        if (name === "User") return UserModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "discussion-4" }, update: { body: "New Body" } },
    discussionSnapshot: {
      id: "discussion-4",
      title: "Title",
      body: "Body",
      Author: { username: "opUser" },
      DiscussionChannels: [{ channelUniqueName: "test_forum" }],
    },
  });

  assert.equal(updates.length, 0);
});
