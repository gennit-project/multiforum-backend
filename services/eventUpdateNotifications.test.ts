import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventUpdateNotificationPayload,
  buildEventUpdateSummaryLines,
} from "./eventUpdateNotifications.js";

test("buildEventUpdateSummaryLines captures cancellation and time changes", () => {
  const summaryLines = buildEventUpdateSummaryLines(
    {
      id: "event-1",
      title: "Phoenix Meetup",
      startTime: "2026-04-01T18:00:00.000Z",
      endTime: "2026-04-01T19:00:00.000Z",
      locationName: "Library",
      address: "123 Main St",
      virtualEventUrl: null,
      canceled: false,
    },
    {
      id: "event-1",
      title: "Phoenix Meetup",
      startTime: "2026-04-01T19:00:00.000Z",
      endTime: "2026-04-01T20:30:00.000Z",
      locationName: "Library",
      address: "123 Main St",
      virtualEventUrl: null,
      canceled: true,
    }
  );

  assert.equal(summaryLines[0], "This event was canceled.");
  assert.match(summaryLines[1] || "", /Time changed to/);
});

test("buildEventUpdateNotificationPayload returns null when no meaningful fields changed", () => {
  const event = {
    id: "event-1",
    title: "Phoenix Meetup",
    startTime: "2026-04-01T18:00:00.000Z",
    endTime: "2026-04-01T19:00:00.000Z",
    locationName: "Library",
    address: "123 Main St",
    virtualEventUrl: null,
    canceled: false,
  };

  assert.equal(buildEventUpdateNotificationPayload(event, event), null);
});

test("buildEventUpdateNotificationPayload builds subject and event URL", () => {
  process.env.FRONTEND_URL = "https://example.com";

  const payload = buildEventUpdateNotificationPayload(
    {
      id: "event-1",
      title: "Phoenix Meetup",
      startTime: "2026-04-01T18:00:00.000Z",
      endTime: "2026-04-01T19:00:00.000Z",
      locationName: "Library",
      address: "123 Main St",
      virtualEventUrl: null,
      canceled: false,
    },
    {
      id: "event-1",
      title: "Phoenix Makers Meetup",
      startTime: "2026-04-01T18:00:00.000Z",
      endTime: "2026-04-01T19:00:00.000Z",
      locationName: "Town Hall",
      address: "456 Oak Ave",
      virtualEventUrl: null,
      canceled: false,
    }
  );

  assert.equal(payload?.subject, "Event updated: Phoenix Makers Meetup");
  assert.equal(payload?.eventUrl, "https://example.com/events/list/search/event-1");
  assert.deepEqual(payload?.summaryLines, [
    "Location changed to Town Hall.",
    'Title changed to "Phoenix Makers Meetup".',
  ]);
});
