import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import archiveCommentResolver from "./archiveComment.js";

type FindArgs = {
  where?: Record<string, unknown>;
};

class ModelStub {
  findCalls: FindArgs[] = [];
  createCalls: Array<Record<string, any>> = [];
  updateCalls: Array<Record<string, any>> = [];

  constructor(
    private findImpl: (args: FindArgs) => any[] = () => [],
    private updateImpl?: (args: Record<string, any>) => Record<string, any>
  ) {}

  async find(args: FindArgs) {
    this.findCalls.push(args);
    return this.findImpl(args);
  }

  async create(args: Record<string, any>) {
    this.createCalls.push(args);
    return {
      issues: [
        {
          id: "issue-1",
          issueNumber: 1,
          flaggedServerRuleViolation: false,
        },
      ],
    };
  }

  async update(args: Record<string, any>) {
    this.updateCalls.push(args);

    if (this.updateImpl) {
      return this.updateImpl(args);
    }

    return {
      issues: [
        {
          id: args.where?.id ?? "issue-1",
          issueNumber: 1,
          flaggedServerRuleViolation:
            args.update?.flaggedServerRuleViolation ?? false,
        },
      ],
    };
  }
}

const createDriver = () => ({
  session: () => ({
    executeWrite: async () => ({
      records: [
        {
          get: () => 1,
        },
      ],
    }),
    run: async () => ({
      records: [],
    }),
    close: async () => {},
  }),
});

const createContext = (userModel: ModelStub) => ({
  req: {
    headers: {
      authorization: `Bearer ${jwt.sign(
        {
          email: "alice@example.com",
          username: "alice",
        },
        "test-secret"
      )}`,
    },
  },
  ogm: {
    model: (name: string) => {
      if (name === "User") {
        return userModel;
      }
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
  driver: createDriver(),
});

const createUserModel = () =>
  new ModelStub(({ where }) => {
    if (where?.username === "alice") {
      return [
        {
          ModerationProfile: {
            displayName: "mod-alice",
          },
        },
      ];
    }

    return [];
  });

const createCommentModel = () =>
  new ModelStub(
    () => [
      {
        id: "comment-1",
        text: "A comment to archive",
        CommentAuthor: {
          __typename: "User",
          username: "cluse",
        },
        Channel: {
          uniqueName: "cats",
        },
      },
    ],
    () => ({ comments: [{ id: "comment-1" }] })
  );

test("archiveComment creates an issue, closes it, archives the comment, and links the issue", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.id === "issue-1") {
      return [
        {
          id: "issue-1",
          issueNumber: 1,
          title: "Issue",
          channelUniqueName: "cats",
          SubscribedToNotifications: [],
        },
      ];
    }
    return [];
  });
  const Comment = createCommentModel();

  const resolver = archiveCommentResolver({
    Issue: Issue as any,
    Comment: Comment as any,
    driver: createDriver(),
  });

  const result = await resolver(
    null,
    {
      commentId: "comment-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this comment.",
    },
    createContext(createUserModel()),
    null
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(Issue.createCalls[0].input[0].relatedCommentId, "comment-1");
  assert.equal(Issue.createCalls[0].input[0].relatedUsername, "cluse");
  assert.equal(Issue.updateCalls.length, 2);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, false);
  assert.equal(Issue.updateCalls[1].update.isOpen, false);
  assert.equal(Comment.updateCalls[0].update.archived, true);
  assert.deepEqual(
    Comment.updateCalls[0].update.RelatedIssues[0].connect[0].where.node,
    { id: "issue-1" }
  );
});

test("archiveComment reuses an existing comment issue and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedCommentId === "comment-1") {
      return [
        {
          id: "existing-issue",
          issueNumber: 4,
          flaggedServerRuleViolation: true,
        },
      ];
    }
    if (where?.id === "existing-issue") {
      return [
        {
          id: "existing-issue",
          issueNumber: 4,
          title: "Existing issue",
          channelUniqueName: "cats",
          SubscribedToNotifications: [],
        },
      ];
    }
    return [];
  });
  const Comment = createCommentModel();

  const resolver = archiveCommentResolver({
    Issue: Issue as any,
    Comment: Comment as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      commentId: "comment-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this comment.",
    },
    createContext(createUserModel()),
    null
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Issue.updateCalls.length, 2);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
  assert.equal(Issue.updateCalls[1].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[1].update.isOpen, false);
  assert.equal(Comment.updateCalls[0].update.archived, true);
  assert.deepEqual(
    Comment.updateCalls[0].update.RelatedIssues[0].connect[0].where.node,
    { id: "existing-issue" }
  );
});
