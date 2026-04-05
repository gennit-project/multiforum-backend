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
  assert.equal(result.relatedAccountType, "ModerationProfile");
  assert.equal(result.relatedAccountName, "Mod Jane");
  assert.equal(result.modProfileName, "Mod Jane");
});

test("throws when the issue has no channel unique name", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-3",
      relatedDiscussionId: "discussion-1",
      relatedEventId: null,
      relatedCommentId: null,
      Channel: null,
    },
  ]);
  const Discussion = new ModelStub([{ id: "discussion-1", Author: { username: "alice" } }]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);

  await assert.rejects(
    () =>
      resolveIssueTarget({
        Issue: Issue as any,
        Discussion: Discussion as any,
        Event: Event as any,
        Comment: Comment as any,
        issueId: "issue-3",
      }),
    /Could not find the forum/
  );
});
