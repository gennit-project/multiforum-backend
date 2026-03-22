import test from "node:test";
import assert from "node:assert/strict";
import { notifyCommentMentions } from "./userMentionNotificationHook.js";

const buildContext = (users: any[]) => {
  const createdNotifications: Array<{ username: string; text: string }> = [];

  return {
    context: {
      ogm: {
        model(modelName: string) {
          assert.equal(modelName, "User");
          return {
            async find() {
              return users;
            },
          };
        },
      },
    },
    createdNotifications,
  };
};

const baseComment = {
  id: "comment-1",
  text: "Hello @cluse",
  CommentAuthor: {
    username: "alice",
    displayName: "Alice",
  },
  DiscussionChannel: {
    discussionId: "discussion-1",
    channelUniqueName: "phoenix",
    Discussion: {
      id: "discussion-1",
      title: "Phoenix Meetup",
    },
  },
};

test("notifyCommentMentions sends email when notifyWhenTagged is enabled", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const sendEmailCalls: any[] = [];
  const { context, createdNotifications } = buildContext([
    {
      username: "cluse",
      notifyWhenTagged: true,
      Email: { address: "cluse@example.com" },
    },
  ]);

  await notifyCommentMentions({
    context,
    comment: baseComment,
    previousText: null,
    nextText: "Hello @cluse",
    dependencies: {
      async createInAppNotification(input: any) {
        createdNotifications.push({
          username: input.username,
          text: input.text,
        });
        return true;
      },
      async sendEmail(message: any) {
        sendEmailCalls.push(message);
        return true;
      },
    },
  });

  assert.equal(createdNotifications.length, 1);
  assert.deepEqual(sendEmailCalls, [
    {
      to: "cluse@example.com",
      subject: "Alice mentioned you in a comment",
      text: `
Alice mentioned you in a comment on the discussion "Phoenix Meetup".

View the comment at:
https://example.com/forums/phoenix/discussions/discussion-1/comments/comment-1
`,
      html: `
<p><strong>Alice</strong> mentioned you in a comment on the discussion "<strong>Phoenix Meetup</strong>".</p>
<p>
  <a href="https://example.com/forums/phoenix/discussions/discussion-1/comments/comment-1">View the comment</a>
</p>
`,
    },
  ]);
});

test("notifyCommentMentions does not send email when notifyWhenTagged is disabled", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const sendEmailCalls: any[] = [];
  const { context, createdNotifications } = buildContext([
    {
      username: "cluse",
      notifyWhenTagged: false,
      Email: { address: "cluse@example.com" },
    },
  ]);

  await notifyCommentMentions({
    context,
    comment: baseComment,
    previousText: null,
    nextText: "Hello @cluse",
    dependencies: {
      async createInAppNotification(input: any) {
        createdNotifications.push({
          username: input.username,
          text: input.text,
        });
        return true;
      },
      async sendEmail(message: any) {
        sendEmailCalls.push(message);
        return true;
      },
    },
  });

  assert.equal(createdNotifications.length, 1);
  assert.deepEqual(sendEmailCalls, []);
});

test("notifyCommentMentions ignores self-mentions and dedupes mixed syntax", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const sendEmailCalls: any[] = [];
  const { context, createdNotifications } = buildContext([
    {
      username: "alice",
      notifyWhenTagged: true,
      Email: { address: "alice@example.com" },
    },
    {
      username: "cluse",
      notifyWhenTagged: true,
      Email: { address: "cluse@example.com" },
    },
  ]);

  await notifyCommentMentions({
    context,
    comment: baseComment,
    previousText: null,
    nextText: "Hello @alice and u/cluse and @Cluse",
    dependencies: {
      async createInAppNotification(input: any) {
        createdNotifications.push({
          username: input.username,
          text: input.text,
        });
        return true;
      },
      async sendEmail(message: any) {
        sendEmailCalls.push(message);
        return true;
      },
    },
  });

  assert.deepEqual(createdNotifications.map((item) => item.username), ["cluse"]);
  assert.equal(sendEmailCalls.length, 1);
  assert.equal(sendEmailCalls[0]?.to, "cluse@example.com");
});
