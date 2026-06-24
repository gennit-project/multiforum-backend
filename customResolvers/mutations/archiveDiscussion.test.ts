import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import archiveDiscussionResolver from "./archiveDiscussion.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";

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

const createContext = (userModel: ModelStub): GraphQLContext => (({
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
}) as unknown as GraphQLContext);

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

test("archiveDiscussion creates an issue, archives the discussion channel, and links the issue", async () => {
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
  const Discussion = new ModelStub(() => [
    {
      id: "discussion-1",
      title: "A discussion to archive",
      Author: {
        username: "cluse",
      },
    },
  ]);
  const DiscussionChannel = new ModelStub(
    () => [
      {
        id: "discussion-channel-1",
      },
    ],
    () => ({ discussionChannels: [{ id: "discussion-channel-1" }] })
  );

  const resolver = archiveDiscussionResolver({
    Issue: Issue as any,
    Discussion: Discussion as any,
    DiscussionChannel: DiscussionChannel as any,
    driver: createDriver() as unknown as Driver,
  });

  const result = await resolver(
    null,
    {
      discussionId: "discussion-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this discussion.",
      channelUniqueName: "cats",
    },
    createContext(createUserModel()),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(
    Issue.createCalls[0].input[0].relatedDiscussionId,
    "discussion-1"
  );
  assert.equal(Issue.updateCalls[0].update.isOpen, false);
  assert.equal(DiscussionChannel.updateCalls[0].update.archived, true);
  assert.deepEqual(
    DiscussionChannel.updateCalls[0].update.RelatedIssues[0].connect[0].where
      .node,
    { id: "issue-1" }
  );
});

test("archiveDiscussion reuses an existing discussion issue and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedDiscussionId === "discussion-1") {
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
  const Discussion = new ModelStub(() => [
    {
      id: "discussion-1",
      title: "A discussion to archive",
      Author: {
        username: "cluse",
      },
    },
  ]);
  const DiscussionChannel = new ModelStub(
    () => [
      {
        id: "discussion-channel-1",
      },
    ],
    () => ({ discussionChannels: [{ id: "discussion-channel-1" }] })
  );

  const resolver = archiveDiscussionResolver({
    Issue: Issue as any,
    Discussion: Discussion as any,
    DiscussionChannel: DiscussionChannel as any,
    driver: createDriver() as unknown as Driver,
  });

  await resolver(
    null,
    {
      discussionId: "discussion-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this discussion.",
      channelUniqueName: "cats",
    },
    createContext(createUserModel()),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.isOpen, false);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
  assert.deepEqual(
    DiscussionChannel.updateCalls[0].update.RelatedIssues[0].connect[0].where
      .node,
    { id: "existing-issue" }
  );
});
