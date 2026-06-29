import test from "node:test";
import assert from "node:assert/strict";
import getResolver from "./createEventSeriesWithChannelConnections.js";
import type { GraphQLContext } from "../../types/context.js";

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

const baseSeriesInput = {
  title: "Weekly Meetup",
  description: "A recurring weekly meetup",
  locationName: "Community Center",
  address: "123 Main St",
  channelConnections: ["general"],
  occurrences: [
    { startTime: "2026-04-01T18:00:00.000Z", endTime: "2026-04-01T19:00:00.000Z" },
    { startTime: "2026-04-08T18:00:00.000Z", endTime: "2026-04-08T19:00:00.000Z" },
  ],
};

const mockCreatedSeries = {
  id: "series-1",
  title: "Weekly Meetup",
  description: "A recurring weekly meetup",
  locationName: "Community Center",
  address: "123 Main St",
  Occurrences: [
    { id: "event-1", title: "Weekly Meetup", startTime: "2026-04-01T18:00:00.000Z", endTime: "2026-04-01T19:00:00.000Z" },
    { id: "event-2", title: "Weekly Meetup", startTime: "2026-04-08T18:00:00.000Z", endTime: "2026-04-08T19:00:00.000Z" },
  ],
  EventChannels: [],
  Tags: [],
  Poster: { username: "testuser" },
};

test("createEventSeriesWithChannelConnections creates series with occurrences", async () => {
  const { driver, sessions } = buildDriver();
  const createCalls: any[] = [];
  const findCalls: any[] = [];

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockCreatedSeries] };
    },
    async find(input: any) {
      findCalls.push(input);
      return [mockCreatedSeries];
    },
  };

  const Event = {};
  const Tag = {};

  const resolver = getResolver({ EventSeries, Event, Tag, driver } as unknown as Parameters<typeof getResolver>[0]);

  const result = await resolver(
    null,
    { input: baseSeriesInput },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  assert.equal(result.id, "series-1");
  assert.equal(result.title, "Weekly Meetup");
  assert.equal(result.Occurrences.length, 2);
  assert.equal(createCalls.length, 1);
  // Should have created EventChannel for each occurrence and channel
  assert.equal(sessions[0].runCalls.length, 2); // 2 occurrences * 1 channel
  assert.equal(sessions[0].closeCalls, 1);
});

test("createEventSeriesWithChannelConnections throws error when no channels provided", async () => {
  const { driver } = buildDriver();

  const EventSeries = {
    async create() {
      return { eventSeries: [] };
    },
    async find() {
      return [];
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  await assert.rejects(
    resolver(
      null,
      { input: { ...baseSeriesInput, channelConnections: [] } },
      { user: { username: "testuser" } } as unknown as GraphQLContext
    ),
    { message: "At least one channel connection is required" }
  );
});

test("createEventSeriesWithChannelConnections throws error when no occurrences provided", async () => {
  const { driver } = buildDriver();

  const EventSeries = {
    async create() {
      return { eventSeries: [] };
    },
    async find() {
      return [];
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  await assert.rejects(
    resolver(
      null,
      { input: { ...baseSeriesInput, occurrences: [] } },
      { user: { username: "testuser" } } as unknown as GraphQLContext
    ),
    { message: "At least one occurrence is required" }
  );
});

test("createEventSeriesWithChannelConnections handles repeat pattern", async () => {
  const { driver, sessions } = buildDriver();
  const createCalls: any[] = [];

  const mockSeriesWithPattern = {
    ...mockCreatedSeries,
    repeatPattern: {
      type: "WEEKLY",
      count: 1,
      daysOfWeek: [3], // Wednesday
      endType: "AFTER_COUNT",
      endCount: 4,
    },
  };

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockSeriesWithPattern] };
    },
    async find() {
      return [mockSeriesWithPattern];
    },
  };

  const inputWithPattern = {
    ...baseSeriesInput,
    repeatPattern: {
      type: "WEEKLY" as const,
      count: 1,
      daysOfWeek: [3],
      endType: "AFTER_COUNT" as const,
      endCount: 4,
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  const result = await resolver(
    null,
    { input: inputWithPattern },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  const typedResult = result as { repeatPattern: { type: string; endType: string; endCount: number } };
  assert.equal(typedResult.repeatPattern.type, "WEEKLY");
  assert.equal(typedResult.repeatPattern.endType, "AFTER_COUNT");
  assert.equal(typedResult.repeatPattern.endCount, 4);

  // Verify repeat pattern was passed to create as a nested RepeatPattern node.
  const createInput = createCalls[0].input[0];
  assert.equal(createInput.repeatPattern.create.node.type, "WEEKLY");
  assert.deepEqual(createInput.repeatPattern.create.node.daysOfWeek, [3]);
});

test("createEventSeriesWithChannelConnections connects tags", async () => {
  const { driver } = buildDriver();
  const createCalls: any[] = [];

  const mockSeriesWithTags = {
    ...mockCreatedSeries,
    Tags: [{ text: "meetup" }, { text: "community" }],
  };

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockSeriesWithTags] };
    },
    async find() {
      return [mockSeriesWithTags];
    },
  };

  const inputWithTags = {
    ...baseSeriesInput,
    tags: ["meetup", "community"],
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  const result = await resolver(
    null,
    { input: inputWithTags },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  assert.equal(result.Tags.length, 2);

  // Verify tags were passed to create with connectOrCreate
  const createInput = createCalls[0].input[0];
  assert.ok(createInput.Tags.connectOrCreate);
  assert.equal(createInput.Tags.connectOrCreate.length, 2);
  assert.equal(createInput.Tags.connectOrCreate[0].where.node.text, "meetup");
});

test("createEventSeriesWithChannelConnections handles location coordinates", async () => {
  const { driver } = buildDriver();
  const createCalls: any[] = [];

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockCreatedSeries] };
    },
    async find() {
      return [mockCreatedSeries];
    },
  };

  const inputWithCoords = {
    ...baseSeriesInput,
    latitude: 33.4484,
    longitude: -112.074,
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  await resolver(
    null,
    { input: inputWithCoords },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  // Verify location was passed to create
  const createInput = createCalls[0].input[0];
  assert.deepEqual(createInput.location, { latitude: 33.4484, longitude: -112.074 });

  // Verify location was also added to occurrences
  const occurrenceInput = createInput.Occurrences.create[0].node;
  assert.deepEqual(occurrenceInput.location, { latitude: 33.4484, longitude: -112.074 });
});

test("createEventSeriesWithChannelConnections skips duplicate EventChannel gracefully", async () => {
  const { driver, sessions } = buildDriver();

  // Override the session to simulate constraint violation on second call
  let runCallCount = 0;
  const customDriver = {
    session() {
      return {
        async run(query: string, params: Record<string, unknown>) {
          runCallCount++;
          if (runCallCount === 2) {
            const error = new Error("Constraint validation failed");
            throw error;
          }
          sessions.push({ runCalls: [{ query, params }], closeCalls: 0 });
          return {};
        },
        async close() {},
      };
    },
  };

  const EventSeries = {
    async create() {
      return { eventSeries: [mockCreatedSeries] };
    },
    async find() {
      return [mockCreatedSeries];
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver: customDriver } as unknown as Parameters<typeof getResolver>[0]);

  // Should not throw despite constraint violation on second EventChannel
  const result = await resolver(
    null,
    { input: baseSeriesInput },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  assert.equal(result.id, "series-1");
});

test("createEventSeriesWithChannelConnections sets occurrence index correctly", async () => {
  const { driver } = buildDriver();
  const createCalls: any[] = [];

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockCreatedSeries] };
    },
    async find() {
      return [mockCreatedSeries];
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  await resolver(
    null,
    { input: baseSeriesInput },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  const createInput = createCalls[0].input[0];
  const occurrences = createInput.Occurrences.create;

  assert.equal(occurrences[0].node.occurrenceIndex, 0);
  assert.equal(occurrences[1].node.occurrenceIndex, 1);
});

test("createEventSeriesWithChannelConnections sets startTimeDayOfWeek and startTimeHourOfDay", async () => {
  const { driver } = buildDriver();
  const createCalls: any[] = [];

  const EventSeries = {
    async create(input: any) {
      createCalls.push(input);
      return { eventSeries: [mockCreatedSeries] };
    },
    async find() {
      return [mockCreatedSeries];
    },
  };

  const resolver = getResolver({ EventSeries, Event: {}, Tag: {}, driver } as unknown as Parameters<typeof getResolver>[0]);

  await resolver(
    null,
    { input: baseSeriesInput },
    { user: { username: "testuser" } } as unknown as GraphQLContext
  );

  const createInput = createCalls[0].input[0];
  const firstOccurrence = createInput.Occurrences.create[0].node;

  // 2026-04-01 is a Wednesday (3), 18:00 UTC
  assert.equal(firstOccurrence.startTimeDayOfWeek, "Wed");
  assert.equal(firstOccurrence.startTimeHourOfDay, 18);
});
