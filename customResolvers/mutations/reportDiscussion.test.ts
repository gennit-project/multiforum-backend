import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import reportDiscussionResolver from "./reportDiscussion.js";

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
    close: async () => {},
  }),
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

const createChannelModel = () =>
  new ModelStub(({ where }) => {
    if (where?.uniqueName === "cats") {
      return [{ uniqueName: "cats" }];
    }

    return [];
  });

const createContext = (models?: { channelModel?: ModelStub }) => ({
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
        return createUserModel();
      }
      if (name === "Channel") {
        return models?.channelModel ?? createChannelModel();
      }
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
  driver: createDriver(),
});

test("reportDiscussion creates an issue and reopens it with a report activity item", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Discussion = new ModelStub(() => [
    {
      id: "discussion-1",
      title: "A discussion to report",
    },
  ]);

  const resolver = reportDiscussionResolver({
    Issue: Issue as any,
    Discussion: Discussion as any,
    driver: createDriver(),
  });

  const result = await resolver(
    null,
    {
      discussionId: "discussion-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this discussion.",
      channelUniqueName: "cats",
    },
    createContext(),
    null
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(
    Issue.createCalls[0].input[0].relatedDiscussionId,
    "discussion-1"
  );
  assert.equal(Issue.createCalls[0].input[0].issueNumber, 1);
  assert.equal(Issue.updateCalls[0].where.id, "issue-1");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, false);
  assert.equal(
    Issue.updateCalls[0].update.ActivityFeed[0].create[0].node.actionType,
    "report"
  );
});

test("reportDiscussion reuses existing issues and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedDiscussionId === "discussion-1") {
      return [
        {
          id: "existing-issue",
          issueNumber: 7,
          flaggedServerRuleViolation: true,
        },
      ];
    }

    return [];
  });
  const Discussion = new ModelStub(() => []);

  const resolver = reportDiscussionResolver({
    Issue: Issue as any,
    Discussion: Discussion as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      discussionId: "discussion-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this discussion.",
      channelUniqueName: "cats",
    },
    createContext(),
    null
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Discussion.findCalls.length, 0);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});

test("reportDiscussion omits the channel connection when the channel is missing", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Discussion = new ModelStub(() => [
    {
      id: "discussion-1",
      title: "A discussion to report",
    },
  ]);

  const resolver = reportDiscussionResolver({
    Issue: Issue as any,
    Discussion: Discussion as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      discussionId: "discussion-1",
      selectedForumRules: [],
      selectedServerRules: ["No spam"],
      reportText: "Please review this discussion.",
      channelUniqueName: "missing-channel",
    },
    createContext({ channelModel: new ModelStub(() => []) }),
    null
  );

  assert.equal(Issue.createCalls[0].input[0].Channel, undefined);
  assert.equal(Issue.createCalls[0].input[0].flaggedServerRuleViolation, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});
