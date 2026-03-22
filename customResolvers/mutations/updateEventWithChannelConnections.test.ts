import test from "node:test";
import assert from "node:assert/strict";
import getResolver from "./updateEventWithChannelConnections.js";

const buildDriver = () => {
  const sessions: Array<{ runCalls: any[]; closeCalls: number }> = [];

  return {
    sessions,
    driver: {
      session() {
        const sessionState = {
          runCalls: [] as any[],
          closeCalls: 0,
        };
        sessions.push(sessionState);
        return {
          async run(query: string, params: Record<string, unknown>) {
            sessionState.runCalls.push({ query, params });
            return {};
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
    Event,
    driver,
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
      where: { id: "event-1" },
      eventUpdateInput: { title: "Phoenix Makers Meetup" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "editor" } },
    null
  );

  assert.equal(updateCalls.length, 1);
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
  assert.deepEqual(sessions[1]?.runCalls[0]?.params, {
    usernames: ["alice", "bob"],
    notificationText: "Phoenix Makers Meetup was updated.",
  });
});

test("updateEventWithChannelConnections skips notifications when no meaningful event update occurred", async () => {
  const { driver, sessions } = buildDriver();
  const sendBatchEmailsCalls: any[] = [];

  const Event = {
    async find() {
      return [baseExistingEvent];
    },
    async update() {
      return {};
    },
  };

  const resolver = getResolver({
    Event,
    driver,
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
      where: { id: "event-1" },
      eventUpdateInput: { title: "Phoenix Meetup" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "editor" } },
    null
  );

  assert.deepEqual(sendBatchEmailsCalls, []);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.runCalls.length, 0);
});
