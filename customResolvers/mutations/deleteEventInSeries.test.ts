import test from "node:test";
import assert from "node:assert/strict";
import getResolver from "./deleteEventInSeries.js";

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

test("deleteEventInSeries THIS_ONLY deletes only the specified event", async () => {
  const { driver, sessions } = buildDriver();
  const deleteCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const EventSeries = {
    async delete() {
      throw new Error("Should not delete series for THIS_ONLY");
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  const result = await resolver(
    null,
    { eventId: "event-1", scope: "THIS_ONLY" },
    {},
    null
  );

  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].where.id, "event-1");
  assert.equal(result.success, true);
  assert.equal(result.deletedCount, 1);
  assert.equal(sessions[0].closeCalls, 1);
});

test("deleteEventInSeries THIS_AND_FUTURE deletes this and future occurrences", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const seriesDeleteCalls: any[] = [];
  const EventSeries = {
    async delete(input: any) {
      seriesDeleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  const result = await resolver(
    null,
    { eventId: "event-1", scope: "THIS_AND_FUTURE" },
    {},
    null
  );

  // Should delete event-1, event-2, event-3 (indices 1, 2, 3)
  assert.equal(deleteCalls.length, 3);
  const deletedIds = deleteCalls.map((c) => c.where.id);
  assert.ok(deletedIds.includes("event-1"));
  assert.ok(deletedIds.includes("event-2"));
  assert.ok(deletedIds.includes("event-3"));

  // Should NOT delete series since event-0 remains
  assert.equal(seriesDeleteCalls.length, 0);

  assert.equal(result.success, true);
  assert.equal(result.deletedCount, 3);
});

test("deleteEventInSeries THIS_AND_FUTURE deletes series when all occurrences removed", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

  // Event at index 0 - deleting this and future means all are deleted
  const firstEvent = {
    id: "event-0",
    title: "Weekly Meetup",
    occurrenceIndex: 0,
    EventSeries: {
      id: "series-1",
      title: "Weekly Meetup",
      Occurrences: [
        { id: "event-0", occurrenceIndex: 0 },
        { id: "event-1", occurrenceIndex: 1 },
      ],
    },
  };

  const Event = {
    async find() {
      return [firstEvent];
    },
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const seriesDeleteCalls: any[] = [];
  const EventSeries = {
    async delete(input: any) {
      seriesDeleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  const result = await resolver(
    null,
    { eventId: "event-0", scope: "THIS_AND_FUTURE" },
    {},
    null
  );

  // Should delete both events
  assert.equal(deleteCalls.length, 2);

  // Should also delete the series since all occurrences are gone
  assert.equal(seriesDeleteCalls.length, 1);
  assert.equal(seriesDeleteCalls[0].where.id, "series-1");

  assert.equal(result.deletedCount, 2);
});

test("deleteEventInSeries ALL_IN_SERIES deletes all occurrences and series", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

  const Event = {
    async find() {
      return [baseEvent];
    },
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const seriesDeleteCalls: any[] = [];
  const EventSeries = {
    async delete(input: any) {
      seriesDeleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  const result = await resolver(
    null,
    { eventId: "event-1", scope: "ALL_IN_SERIES" },
    {},
    null
  );

  // Should delete all 4 events
  assert.equal(deleteCalls.length, 4);
  const deletedIds = deleteCalls.map((c) => c.where.id);
  assert.ok(deletedIds.includes("event-0"));
  assert.ok(deletedIds.includes("event-1"));
  assert.ok(deletedIds.includes("event-2"));
  assert.ok(deletedIds.includes("event-3"));

  // Should also delete the series
  assert.equal(seriesDeleteCalls.length, 1);
  assert.equal(seriesDeleteCalls[0].where.id, "series-1");

  assert.equal(result.success, true);
  assert.equal(result.deletedCount, 4);
  assert.ok(result.message.includes("4 event(s)"));
});

test("deleteEventInSeries throws error when event not found", async () => {
  const { driver } = buildDriver();

  const Event = {
    async find() {
      return [];
    },
    async delete() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await assert.rejects(
    resolver(null, { eventId: "nonexistent", scope: "THIS_ONLY" }, {}, null),
    { message: /Event not found/ }
  );
});

test("deleteEventInSeries throws error for invalid scope", async () => {
  const { driver } = buildDriver();

  const Event = {
    async find() {
      return [baseEvent];
    },
    async delete() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await assert.rejects(
    resolver(
      null,
      { eventId: "event-1", scope: "INVALID" as any },
      {},
      null
    ),
    { message: /Invalid scope/ }
  );
});

test("deleteEventInSeries handles standalone event without series", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

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
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const seriesDeleteCalls: any[] = [];
  const EventSeries = {
    async delete(input: any) {
      seriesDeleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries, driver });

  // Even with ALL_IN_SERIES scope, should only delete the single event
  const result = await resolver(
    null,
    { eventId: "event-solo", scope: "ALL_IN_SERIES" },
    {},
    null
  );

  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].where.id, "event-solo");
  assert.equal(seriesDeleteCalls.length, 0);
  assert.equal(result.deletedCount, 1);
});

test("deleteEventInSeries THIS_ONLY handles standalone event", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

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
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  const result = await resolver(
    null,
    { eventId: "event-solo", scope: "THIS_ONLY" },
    {},
    null
  );

  assert.equal(deleteCalls.length, 1);
  assert.equal(result.success, true);
  assert.equal(result.deletedCount, 1);
});

test("deleteEventInSeries THIS_AND_FUTURE handles standalone event", async () => {
  const { driver } = buildDriver();
  const deleteCalls: any[] = [];

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
    async delete(input: any) {
      deleteCalls.push(input);
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  const result = await resolver(
    null,
    { eventId: "event-solo", scope: "THIS_AND_FUTURE" },
    {},
    null
  );

  assert.equal(deleteCalls.length, 1);
  assert.equal(result.deletedCount, 1);
});

test("deleteEventInSeries closes session on success", async () => {
  const { driver, sessions } = buildDriver();

  const Event = {
    async find() {
      return [{ ...baseEvent, EventSeries: null }];
    },
    async delete() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await resolver(
    null,
    { eventId: "event-1", scope: "THIS_ONLY" },
    {},
    null
  );

  assert.equal(sessions[0].closeCalls, 1);
});

test("deleteEventInSeries closes session on error", async () => {
  const { driver, sessions } = buildDriver();

  const Event = {
    async find() {
      throw new Error("Database error");
    },
    async delete() {
      return {};
    },
  };

  const resolver = getResolver({ Event, EventSeries: {}, driver });

  await assert.rejects(
    resolver(null, { eventId: "event-1", scope: "THIS_ONLY" }, {}, null)
  );

  assert.equal(sessions[0].closeCalls, 1);
});
