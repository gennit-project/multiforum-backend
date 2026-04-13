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
      Author: { username: "alice", isBot: false },
    },
  ]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);
  const User = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
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
  const User = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    issueId: "issue-2",
    suspendedEntityName: "mod",
  });

  assert.equal(result.channelUniqueName, "dogs");
  assert.equal(result.scope, "channel");
  assert.equal(result.relatedAccountType, "ModerationProfile");
  assert.equal(result.relatedAccountName, "Mod Jane");
  assert.equal(result.modProfileName, "Mod Jane");
});

test("prefers related mod profile metadata on channel-scoped issues", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-2b",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: "comment-1",
      relatedUsername: null,
      relatedModProfileName: "Mod Jane",
      Channel: { uniqueName: "dogs" },
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);
  const User = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    issueId: "issue-2b",
    suspendedEntityName: "mod",
  });

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
  const User = new ModelStub([{ username: "alice", isBot: false }]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    issueId: "issue-3",
  });

  assert.equal(result.channelUniqueName, null);
  assert.equal(result.scope, "server");
  assert.equal(result.relatedAccountType, "User");
  assert.equal(result.relatedAccountName, "alice");
});

test("resolves a wiki revision author's username", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-wiki-revision",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: null,
      relatedWikiPageId: "wiki-page-1",
      relatedWikiRevisionId: "revision-1",
      relatedUsername: null,
      relatedModProfileName: null,
      Channel: { uniqueName: "docs" },
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);
  const User = new ModelStub([]);
  const WikiPage = new ModelStub([]);
  const TextVersion = new ModelStub([
    {
      id: "revision-1",
      Author: { username: "wiki-editor", isBot: false },
    },
  ]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    WikiPage: WikiPage as any,
    TextVersion: TextVersion as any,
    issueId: "issue-wiki-revision",
  });

  assert.equal(result.channelUniqueName, "docs");
  assert.equal(result.relatedAccountType, "User");
  assert.equal(result.relatedAccountName, "wiki-editor");
  assert.equal(result.username, "wiki-editor");
});

test("falls back to a wiki page's original author", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-wiki-page",
      relatedDiscussionId: null,
      relatedEventId: null,
      relatedCommentId: null,
      relatedWikiPageId: "wiki-page-1",
      relatedWikiRevisionId: null,
      relatedUsername: null,
      relatedModProfileName: null,
      Channel: { uniqueName: "docs" },
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);
  const User = new ModelStub([]);
  const WikiPage = new ModelStub([
    {
      id: "wiki-page-1",
      OriginalAuthor: { username: "page-creator", isBot: false },
      VersionAuthor: { username: "last-editor", isBot: false },
    },
  ]);
  const TextVersion = new ModelStub([]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    WikiPage: WikiPage as any,
    TextVersion: TextVersion as any,
    issueId: "issue-wiki-page",
  });

  assert.equal(result.relatedAccountName, "page-creator");
  assert.equal(result.username, "page-creator");
});

test("prefers related usernames on channel-scoped issues", async () => {
  const Issue = new ModelStub([
    {
      id: "issue-3b",
      relatedDiscussionId: "discussion-1",
      relatedEventId: null,
      relatedCommentId: null,
      relatedUsername: "alice",
      relatedModProfileName: null,
      Channel: { uniqueName: "cats" },
    },
  ]);
  const Discussion = new ModelStub([]);
  const Event = new ModelStub([]);
  const Comment = new ModelStub([]);
  const User = new ModelStub([{ username: "alice", isBot: false }]);

  const result = await resolveIssueTarget({
    Issue: Issue as any,
    Discussion: Discussion as any,
    Event: Event as any,
    Comment: Comment as any,
    User: User as any,
    issueId: "issue-3b",
  });

  assert.equal(result.username, "alice");
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
  const User = new ModelStub([]);

  await assert.rejects(
    () =>
      resolveIssueTarget({
        Issue: Issue as any,
        Discussion: Discussion as any,
        Event: Event as any,
        Comment: Comment as any,
        User: User as any,
        issueId: "issue-4",
      }),
    /Could not find the user account name/
  );
});
