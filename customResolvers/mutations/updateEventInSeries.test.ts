import test from "node:test";
import assert from "node:assert/strict";
import getResolver from "./updateEventInSeries.js";

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

const baseEvent = {
  id: "event-1",
  title: "Weekly Meetup",
  occurrenceIndex: 1,
  EventSeries: {
    id: "series-1",
    title: "Weekly Meetup",
    Occurrences: [
      { id: "event-0", occurrenceIndex: 0 },
      { id: "event-1", occurrenceIndex: 1 },
      { id: "event-2", occurrenceIndex: 2 },
      { id: "event-3", occurrenceIndex: 3 },
    ],
  },
};

const updatedEvent = {
  id: "event-1",
  title: "Updated Meetup",
  description: "Updated description",
  startTime: "2026-04-08T18:00:00.000Z",
  endTime: "2026-04-08T19:00:00.000Z",
  EventSeries: { id: "series-1", title: "Updated Meetup" },
  EventChannels: [],
  Tags: [],
  Poster: { username: "testuser" },
};

test("updateEventInSeries THIS_ONLY updates only the specified event", async () => {
  const { driver, sessions } = buildDriver();
  const updateCalls: any[] = [];
  const findCalls: any[] = [];

  const Event = {
    async find(input: any) {
      findCalls.push(input);
      if (findCalls.length === 1) {
        return [baseEvent];
      }
      return [updatedEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const EventSeries = {
    async update() {
      throw new Error("Should not update series for THIS_ONLY");
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  const result = await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_ONLY",
      eventUpdateInput: { startTime: "2026-04-08T19:00:00.000Z" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "testuser" } },
    null
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].where.id, "event-1");
  assert.equal(result.id, "event-1");
  assert.equal(sessions[0].closeCalls, 1);
});

test("updateEventInSeries THIS_ONLY sets override flags for series-level changes", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const EventSeries = {
    async update() {
      throw new Error("Should not update series for THIS_ONLY");
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_ONLY",
      eventUpdateInput: { title: "Custom Title", description: "Custom desc" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "testuser" } },
    null
  );

  assert.equal(updateCalls.length, 1);
  const update = updateCalls[0].update;
  assert.equal(update.title, "Custom Title");
  assert.equal(update.description, "Custom desc");
  assert.equal(update.overrideSeriesTitle, true);
  assert.equal(update.overrideSeriesDescription, true);
});

test("updateEventInSeries THIS_AND_FUTURE updates this and future occurrences", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const seriesUpdateCalls: any[] = [];
  const EventSeries = {
    async update(input: any) {
      seriesUpdateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_AND_FUTURE",
      eventUpdateInput: { title: "New Title" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "testuser" } },
    null
  );

  // Should update event-1, event-2, event-3 (indices 1, 2, 3)
  assert.equal(updateCalls.length, 3);
  assert.equal(updateCalls[0].where.id, "event-1");
  assert.equal(updateCalls[1].where.id, "event-2");
  assert.equal(updateCalls[2].where.id, "event-3");

  // Should also update series template for series-level field
  assert.equal(seriesUpdateCalls.length, 1);
  assert.equal(seriesUpdateCalls[0].where.id, "series-1");
  assert.equal(seriesUpdateCalls[0].update.title, "New Title");
});

test("updateEventInSeries ALL_IN_SERIES updates all occurrences", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const seriesUpdateCalls: any[] = [];
  const EventSeries = {
    async update(input: any) {
      seriesUpdateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "ALL_IN_SERIES",
      eventUpdateInput: { title: "All Updated", description: "New description" },
      channelConnections: [],
      channelDisconnections: [],
    },
    { user: { username: "testuser" } },
    null
  );

  // Should update all 4 events
  assert.equal(updateCalls.length, 4);
  const updatedIds = updateCalls.map((c) => c.where.id);
  assert.ok(updatedIds.includes("event-0"));
  assert.ok(updatedIds.includes("event-1"));
  assert.ok(updatedIds.includes("event-2"));
  assert.ok(updatedIds.includes("event-3"));

  // Should also update series template
  assert.equal(seriesUpdateCalls.length, 1);
  assert.equal(seriesUpdateCalls[0].update.title, "All Updated");
  assert.equal(seriesUpdateCalls[0].update.description, "New description");
});

test("updateEventInSeries throws error when event not found", async () => {
  const { driver } = buildDriver();

  const Event = {
    async find() {
      return [];
    },
    async update() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await assert.rejects(
    resolver(
      null,
      {
        eventId: "nonexistent",
        scope: "THIS_ONLY",
        eventUpdateInput: { title: "Test" },
        channelConnections: [],
        channelDisconnections: [],
      },
      {},
      null
    ),
    { message: /Event not found/ }
  );
});

test("updateEventInSeries throws error for invalid scope", async () => {
  const { driver } = buildDriver();

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await assert.rejects(
    resolver(
      null,
      {
        eventId: "event-1",
        scope: "INVALID_SCOPE" as any,
        eventUpdateInput: { title: "Test" },
        channelConnections: [],
        channelDisconnections: [],
      },
      {},
      null
    ),
    { message: /Invalid scope/ }
  );
});

test("updateEventInSeries handles standalone event without series", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const standaloneEvent = {
    id: "event-solo",
    title: "Solo Event",
    occurrenceIndex: null,
    EventSeries: null,
  };

  const Event = {
    async find() {
      return [standaloneEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const seriesUpdateCalls: any[] = [];
  const EventSeries = {
    async update(input: any) {
      seriesUpdateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  // Even with ALL_IN_SERIES scope, should only update the single event
  await resolver(
    null,
    {
      eventId: "event-solo",
      scope: "ALL_IN_SERIES",
      eventUpdateInput: { title: "Updated Solo" },
      channelConnections: [],
      channelDisconnections: [],
    },
    {},
    null
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].where.id, "event-solo");
  // Should not update series since there isn't one
  assert.equal(seriesUpdateCalls.length, 0);
});

test("updateEventInSeries handles channel connections", async () => {
  const { driver, sessions } = buildDriver();

  const Event = {
    async find() {
      return [{ ...baseEvent, EventSeries: null }];
    },
    async update() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_ONLY",
      eventUpdateInput: {},
      channelConnections: ["channel-a", "channel-b"],
      channelDisconnections: [],
    },
    {},
    null
  );

  // Should have run 2 connection queries
  assert.equal(sessions[0].runCalls.length, 2);
  assert.equal(sessions[0].runCalls[0].params.channelUniqueName, "channel-a");
  assert.equal(sessions[0].runCalls[1].params.channelUniqueName, "channel-b");
});

test("updateEventInSeries handles channel disconnections", async () => {
  const { driver, sessions } = buildDriver();

  const Event = {
    async find() {
      return [{ ...baseEvent, EventSeries: null }];
    },
    async update() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_ONLY",
      eventUpdateInput: {},
      channelConnections: [],
      channelDisconnections: ["channel-x"],
    },
    {},
    null
  );

  assert.equal(sessions[0].runCalls.length, 1);
  assert.equal(sessions[0].runCalls[0].params.channelUniqueName, "channel-x");
  assert.equal(sessions[0].runCalls[0].params.eventId, "event-1");
});

test("updateEventInSeries does not update series for occurrence-level only changes", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const seriesUpdateCalls: any[] = [];
  const EventSeries = {
    async update(input: any) {
      seriesUpdateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "ALL_IN_SERIES",
      eventUpdateInput: { startTime: "2026-04-08T20:00:00.000Z", canceled: true },
      channelConnections: [],
      channelDisconnections: [],
    },
    {},
    null
  );

  // All events should be updated
  assert.equal(updateCalls.length, 4);

  // Series should NOT be updated since startTime and canceled are occurrence-level
  assert.equal(seriesUpdateCalls.length, 0);
});

test("updateEventInSeries THIS_ONLY does not set override flags for occurrence-level changes", async () => {
  const { driver } = buildDriver();
  const updateCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async update(input: any) {
      updateCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await resolver(
    null,
    {
      eventId: "event-1",
      scope: "THIS_ONLY",
      eventUpdateInput: { startTime: "2026-04-08T20:00:00.000Z" },
      channelConnections: [],
      channelDisconnections: [],
    },
    {},
    null
  );

  const update = updateCalls[0].update;
  assert.equal(update.startTime, "2026-04-08T20:00:00.000Z");
  // Should not have any override flags since startTime is occurrence-level
  assert.equal(update.overrideSeriesStartTime, undefined);
});
