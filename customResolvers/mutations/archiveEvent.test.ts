import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import archiveEventResolver from "./archiveEvent.js";

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
    if (where?.uniqueName !== "cats") {
      return [];
    }

    return [
      {
        DefaultModRole: {
          canHideEvent: true,
        },
        ElevatedModRole: null,
        SuspendedModRole: null,
        SuspendedMods: [],
        Moderators: [],
      },
    ];
  });

const createServerConfigModel = () =>
  new ModelStub(() => [
    {
      DefaultModRole: {
        canHideEvent: true,
      },
      DefaultSuspendedModRole: {
        canHideEvent: false,
      },
      DefaultElevatedModRole: {
        canHideEvent: true,
      },
    },
  ]);

const createContext = ({
  userModel,
  channelModel = createChannelModel(),
  serverConfigModel = createServerConfigModel(),
}: {
  userModel: ModelStub;
  channelModel?: ModelStub;
  serverConfigModel?: ModelStub;
}) => ({
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
      if (name === "Channel") {
        return channelModel;
      }
      if (name === "ServerConfig") {
        return serverConfigModel;
      }
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
  driver: createDriver(),
});

test("archiveEvent creates an issue, archives the event channel, and links the issue", async () => {
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
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "A gathering to archive",
      Poster: {
        username: "cluse",
      },
    },
  ]);
  const EventChannel = new ModelStub(
    () => [
      {
        id: "event-channel-1",
      },
    ],
    () => ({ eventChannels: [{ id: "event-channel-1" }] })
  );

  const resolver = archiveEventResolver({
    Issue: Issue as any,
    Event: Event as any,
    EventChannel: EventChannel as any,
    driver: createDriver(),
  });

  const result = await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this event.",
      channelUniqueName: "cats",
    },
    createContext({ userModel: createUserModel() }),
    null
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(Issue.createCalls[0].input[0].relatedEventId, "event-1");
  assert.equal(Issue.updateCalls[0].update.isOpen, false);
  assert.equal(EventChannel.updateCalls[0].update.archived, true);
  assert.deepEqual(
    EventChannel.updateCalls[0].update.RelatedIssues[0].connect[0].where.node,
    { id: "issue-1" }
  );
});

test("archiveEvent reuses an existing event issue and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedEventId === "event-1") {
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
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "A gathering to archive",
      Poster: {
        username: "cluse",
      },
    },
  ]);
  const EventChannel = new ModelStub(
    () => [
      {
        id: "event-channel-1",
      },
    ],
    () => ({ eventChannels: [{ id: "event-channel-1" }] })
  );

  const resolver = archiveEventResolver({
    Issue: Issue as any,
    Event: Event as any,
    EventChannel: EventChannel as any,
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Archiving this event.",
      channelUniqueName: "cats",
    },
    createContext({ userModel: createUserModel() }),
    null
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.isOpen, false);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
  assert.deepEqual(
    EventChannel.updateCalls[0].update.RelatedIssues[0].connect[0].where.node,
    { id: "existing-issue" }
  );
});
