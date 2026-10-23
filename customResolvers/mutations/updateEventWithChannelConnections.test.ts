import test from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import getResolver from "./updateEventWithChannelConnections.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventWriteRepository } from "../../services/persistence/eventWriteRepository.js";
import type { GraphQLResolveInfo } from "graphql";

const buildDriver = (callbackAttempts = 1) => {
  const sessions: Array<{
    runCalls: any[];
    executeWriteCalls: number;
    closeCalls: number;
  }> = [];

  return {
    sessions,
    driver: {
      session() {
        const sessionState = {
          runCalls: [] as any[],
          executeWriteCalls: 0,
          closeCalls: 0,
        };
        sessions.push(sessionState);
        return {
          async run(query: string, params: Record<string, unknown>) {
            sessionState.runCalls.push({ query, params });
            return {
              records: [{ get: () => ({ toNumber: () => 1 }) }],
            };
          },
          async executeWrite<T>(work: (transaction: {
            run: (query: string, params: Record<string, unknown>) => Promise<object>;
          }) => Promise<T>) {
            sessionState.executeWriteCalls += 1;
            let result: T | undefined;
            for (let attempt = 0; attempt < callbackAttempts; attempt += 1) {
              result = await work({
                async run(query: string, params: Record<string, unknown>) {
                  sessionState.runCalls.push({ query, params });
                  return {};
                },
              });
            }
            return result as T;
          },
          async close() {
            sessionState.closeCalls += 1;
          },
        };
      },
    },
  };
};

const baseExistingEvent = {
  id: "event-1",
  title: "Phoenix Meetup",
  startTime: "2026-04-01T18:00:00.000Z",
  endTime: "2026-04-01T19:00:00.000Z",
  locationName: "Library",
  address: "123 Main St",
  virtualEventUrl: null,
  canceled: false,
};

const baseUpdatedEvent = {
  ...baseExistingEvent,
  title: "Phoenix Makers Meetup",
  description: "Updated description",
  startTimeDayOfWeek: 3,
  startTimeHourOfDay: 18,
  cost: null,
  isAllDay: false,
  isHostedByOP: false,
  coverImageURL: null,
  Poster: { username: "event-owner" },
  EventChannels: [],
  SubscribedToNotifications: [],
  createdAt: "2026-03-20T12:00:00.000Z",
  updatedAt: "2026-03-21T12:00:00.000Z",
  Tags: [],
};

test("updateEventWithChannelConnections notifies update watchers except the actor", async () => {
  const { driver, sessions } = buildDriver();
  const sendBatchEmailsCalls: any[] = [];
  const updateCalls: any[] = [];
  const eventFindCalls: any[] = [];

  const Event = {
    async find(input: any) {
      eventFindCalls.push(input);
      if (eventFindCalls.length === 1) {
        return [baseExistingEvent];
      }

      return [
        {
          ...baseUpdatedEvent,
          SubscribedToEventUpdates: [
            { username: "alice", Email: { address: "alice@example.com" } },
            { username: "editor", Email: { address: "editor@example.com" } },
            { username: "bob", Email: null },
          ],
        },
      ];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({
    eventWriteRepository: {
      findUpdateSnapshot: async (where) => Event.find({where}),
      updateWithinTransaction: async (where, update, tx) => { await Event.update({where,update,context:{executionContext:tx}}); },
      findUpdatedEvent: async (id) => Event.find({where:{id}}),
    } as EventWriteRepository,
    driver: driver as unknown as Driver,
    dependencies: {
      buildEventUpdateNotificationPayload() {
        return {
          subject: "Event updated: Phoenix Makers Meetup",
          notificationText: "Phoenix Makers Meetup was updated.",
          summaryLines: ['Title changed to "Phoenix Makers Meetup".'],
          eventUrl: "https://example.com/events/list/search/event-1",
        };
      },
      createEventUpdateNotificationEmail() {
        return {
          subject: "Event updated: Phoenix Makers Meetup",
          plainText: "plain body",
          html: "<p>html body</p>",
        };
      },
      async sendBatchEmails(messages) {
        sendBatchEmailsCalls.push(messages);
        return true;
      },
    },
  });

  const result = await resolver(
    null,
    {
      where: { id: { eq: "event-1" } },
      eventUpdateInput: { title: { set: "Phoenix Makers Meetup" } },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "editor" } } as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(updateCalls.length, 1);
  assert.ok(updateCalls[0].context.executionContext);
  assert.equal(result.title, "Phoenix Makers Meetup");
  assert.deepEqual(sendBatchEmailsCalls, [
    [
      {
        to: "alice@example.com",
        subject: "Event updated: Phoenix Makers Meetup",
        text: "plain body",
        html: "<p>html body</p>",
      },
    ],
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.executeWriteCalls, 1);
  assert.equal(sessions[1]?.executeWriteCalls, 0);
  assert.deepEqual(sessions[1]?.runCalls[0]?.params, {
    usernames: ["alice", "bob"],
    notificationText: "Phoenix Makers Meetup was updated.",
    notificationType: "event",
  });
});

test("updateEventWithChannelConnections skips notifications when no meaningful event update occurred", async () => {
  const { driver, sessions } = buildDriver();
  const sendBatchEmailsCalls: any[] = [];

  const Event = {
    async find(_input?: unknown) {
      return [baseExistingEvent];
    },
    async update(_input?: unknown) {
      return {};
    },
  };

  const resolver = getResolver({
    eventWriteRepository: {
      findUpdateSnapshot: async (where) => Event.find({where}),
      updateWithinTransaction: async (where, update, tx) => { await Event.update({where,update,context:{executionContext:tx}}); },
      findUpdatedEvent: async (id) => Event.find({where:{id}}),
    } as EventWriteRepository,
    driver: driver as unknown as Driver,
    dependencies: {
      buildEventUpdateNotificationPayload() {
        return null;
      },
      createEventUpdateNotificationEmail() {
        throw new Error("should not build email content");
      },
      async sendBatchEmails(messages) {
        sendBatchEmailsCalls.push(messages);
        return true;
      },
    },
  });

  await resolver(
    null,
    {
      where: { id: { eq: "event-1" } },
      eventUpdateInput: { title: { set: "Phoenix Meetup" } },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "editor" } } as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  assert.deepEqual(sendBatchEmailsCalls, []);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.runCalls.length, 0);
});

test("updateEventWithChannelConnections does not duplicate email when Neo4j retries", async () => {
  const { driver, sessions } = buildDriver(2);
  const sendBatchEmailsCalls: any[] = [];
  let findCalls = 0;
  let updateCalls = 0;
  const Event = {
    async find(_input?: unknown) {
      findCalls += 1;
      return findCalls === 1
        ? [baseExistingEvent]
        : [{
            ...baseUpdatedEvent,
            SubscribedToEventUpdates: [
              { username: "alice", Email: { address: "alice@example.com" } },
            ],
          }];
    },
    async update(_input?: unknown) {
      updateCalls += 1;
      return {};
    },
  };
  const resolver = getResolver({
    eventWriteRepository: {
      findUpdateSnapshot: async (where) => Event.find({where}),
      updateWithinTransaction: async (where, update, tx) => { await Event.update({where,update,context:{executionContext:tx}}); },
      findUpdatedEvent: async (id) => Event.find({where:{id}}),
    } as EventWriteRepository,
    driver: driver as unknown as Driver,
    dependencies: {
      buildEventUpdateNotificationPayload: () => ({
        subject: "Updated",
        notificationText: "Updated",
        summaryLines: ["Updated"],
        eventUrl: "https://example.com/event-1",
      }),
      createEventUpdateNotificationEmail: () => ({
        subject: "Updated",
        plainText: "Updated",
        html: "<p>Updated</p>",
      }),
      sendBatchEmails: async (messages) => {
        sendBatchEmailsCalls.push(messages);
        return true;
      },
    },
  });

  await resolver(
    null,
    {
      where: { id: { eq: "event-1" } },
      eventUpdateInput: { title: { set: "Phoenix Makers Meetup" } },
      channelConnections: ["events"],
      channelDisconnections: [],
    },
    { user: { username: "editor" } } as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(updateCalls, 2);
  assert.equal(sessions[0]?.runCalls.length, 2);
  assert.equal(sendBatchEmailsCalls.length, 1);
});
