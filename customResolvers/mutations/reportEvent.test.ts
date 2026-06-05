import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import reportEventResolver from "./reportEvent.js";

type FindArgs = {
  where?: Record<string, unknown>;
};

class ModelStub {
  findCalls: FindArgs[] = [];
  createCalls: Array<Record<string, any>> = [];
  updateCalls: Array<Record<string, any>> = [];

  constructor(private findImpl: (args: FindArgs) => any[] = () => []) {}

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

const createContext = () => ({
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
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
  driver: createDriver(),
});

test("reportEvent creates an issue and reopens it with a report activity item", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "An event to report",
    },
  ]);

  const resolver = reportEventResolver({
    Issue: Issue as any,
    Event: Event as any,
    driver: createDriver(),
  });

  const result = await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(Issue.createCalls[0].input[0].relatedEventId, "event-1");
  assert.equal(Issue.createCalls[0].input[0].issueNumber, 1);
  assert.equal(Issue.updateCalls[0].where.id, "issue-1");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, false);
  assert.equal(
    Issue.updateCalls[0].update.ActivityFeed[0].create[0].node.actionType,
    "report"
  );
});

test("reportEvent reuses existing issues and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedEventId === "event-1") {
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
  const Event = new ModelStub(() => []);

  const resolver = reportEventResolver({
    Issue: Issue as any,
    Event: Event as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Event.findCalls.length, 0);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});

test("reportEvent flags new issues for server-rule violations", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "An event to report",
    },
  ]);

  const resolver = reportEventResolver({
    Issue: Issue as any,
    Event: Event as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: [],
      selectedServerRules: ["No spam"],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null
  );

  assert.equal(Issue.createCalls[0].input[0].flaggedServerRuleViolation, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});
