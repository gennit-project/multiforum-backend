import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import archiveEventResolver from "./archiveEvent.js";
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
    run: async () => ({
      records: [],
    }),
    close: async () => {},
  }),
});

const requestIdentityRepository = {
  findByUsername: async () => ({
    username: "alice",
    dateOfBirth: null,
    modProfileName: "mod-alice",
  }),
  findByEmail: async () => null,
  userExists: async () => true,
};

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
  issueModel,
  userModel,
  channelModel = createChannelModel(),
  serverConfigModel = createServerConfigModel(),
}: {
  userModel: ModelStub;
  issueModel: ModelStub;
  channelModel?: ModelStub;
  serverConfigModel?: ModelStub;
}): GraphQLContext => (({
  notificationSnapshotRepository: {
    findIssueSubscribers: (id: string) => issueModel.find({where:{id}}),
    findArchivedAuthor: (username: string) => userModel.find({where:{username}}),
  },
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
  requestIdentityRepository,
  channelPermissionRepository: {
    findAuthorizationSnapshot: async (channelUniqueName: string) => {
      const channels = await channelModel.find({
        where: { uniqueName: channelUniqueName },
      });
      const channel = channels[0];
      return channel
        ? {
            Admins: [],
            Moderators: channel.Moderators ?? [],
            DefaultModRole: channel.DefaultModRole ?? null,
            ElevatedModRole: channel.ElevatedModRole ?? null,
            SuspendedModRole: channel.SuspendedModRole ?? null,
          }
        : null;
    },
    findTargetedSuspensions: async () => ({
      userSuspensions: [],
      modSuspensions: [],
    }),
  },
}) as unknown as GraphQLContext);

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
    eventModerationRepository: {
      findEvent: async (where: any) => Event.find({where}),
      findRelatedIssues: async (where: any) => Issue.find({where}),
      createArchiveIssue: async (input: any) => Issue.create({input}),
      recordAction: async (where: any, update: any) => Issue.update({where,update}),
      findEventChannel: async (where: any) => EventChannel.find({where}),
      setArchived: async (where: any, update: any) => EventChannel.update({where,update}),
    } as any,
    driver: createDriver() as unknown as Driver,
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
    createContext({ userModel: createUserModel(), issueModel: Issue }),
    null as unknown as GraphQLResolveInfo
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
    eventModerationRepository: {
      findEvent: async (where: any) => Event.find({where}),
      findRelatedIssues: async (where: any) => Issue.find({where}),
      createArchiveIssue: async (input: any) => Issue.create({input}),
      recordAction: async (where: any, update: any) => Issue.update({where,update}),
      findEventChannel: async (where: any) => EventChannel.find({where}),
      setArchived: async (where: any, update: any) => EventChannel.update({where,update}),
    } as any,
    driver: createDriver() as unknown as Driver,
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
    createContext({ userModel: createUserModel(), issueModel: Issue }),
    null as unknown as GraphQLResolveInfo
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
