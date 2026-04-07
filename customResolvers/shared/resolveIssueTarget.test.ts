import assert from "node:assert/strict";
import test from "node:test";
import { resolveIssueTarget } from "./resolveIssueTarget.js";

class ModelStub<T> {
  private result: T[];

  constructor(result: T[]) {
    this.result = result;
  }

  async find() {
    return this.result;
  }
}

test("resolves a discussion author's username", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-1",
      relatedDiscussionId: "discussion-1",
      relatedEventId: null,
      relatedCommentId: null,
      Channel: { uniqueName: "cats" },
    },
  ]);
  const Discussion = new ModelStub([
    {
      id: "discussion-1",
      Author: { username: "alice" },
    },
  ]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    issueId: "issue-1",
  });

  assert.equal(result.channelUniqueName, "cats");
  assert.equal(result.scope, "channel");
  assert.equal(result.relatedAccountType, "User");
  assert.equal(result.relatedAccountName, "alice");
  assert.equal(result.username, "alice");
});

test("resolves a comment author's moderation profile", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-2",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: "comment-1",
      Channel: { uniqueName: "dogs" },
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([
    {
      id: "comment-1",
      CommentAuthor: { displayName: "Mod Jane" },
    },
  ]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    issueId: "issue-2",
    suspendedEntityName: "mod",
  });

  assert.equal(result.channelUniqueName, "dogs");
  assert.equal(result.scope, "channel");
  assert.equal(result.relatedAccountType, "ModerationProfile");
  assert.equal(result.relatedAccountName, "Mod Jane");
  assert.equal(result.modProfileName, "Mod Jane");
});

test("resolves a server-scoped issue from related username", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-3",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: null,
      relatedUsername: "alice",
      relatedModProfileName: null,
      Channel: null,
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    issueId: "issue-3",
  });

  assert.equal(result.channelUniqueName, null);
  assert.equal(result.scope, "server");
  assert.equal(result.relatedAccountType, "User");
  assert.equal(result.relatedAccountName, "alice");
});

test("throws when a server-scoped issue has no related account", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-4",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: null,
      relatedUsername: null,
      relatedModProfileName: null,
      Channel: null,
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);

  await assert.rejects(
    () =>
      resolveIssueTarget({
        Issue: Issue as any,
        Discussion: Discussion as any,
        Event: Event as any,
        Comment: Comment as any,
        issueId: "issue-4",
      }),
    /Could not find the user account name/
  );
});
