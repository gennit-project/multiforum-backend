import { DateTime } from "luxon";

export type EventUpdateSnapshot = {
  id: string;
  title: string;
  startTime?: string | null;
  endTime?: string | null;
  locationName?: string | null;
  address?: string | null;
  virtualEventUrl?: string | null;
  canceled: boolean;
};

export type EventUpdateNotificationPayload = {
  subject: string;
  notificationText: string;
  summaryLines: string[];
  eventUrl: string;
};

const formatDateTime = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const dateTime = DateTime.fromISO(value);
  if (!dateTime.isValid) {
    return value;
  }

  return dateTime.toLocaleString(DateTime.DATETIME_MED);
};

const formatLocation = (event: EventUpdateSnapshot): string | null => {
  return event.locationName || event.address || event.virtualEventUrl || null;
};

export const buildEventUpdateSummaryLines = (
  before: EventUpdateSnapshot,
  after: EventUpdateSnapshot
): string[] => {
  const summaryLines: string[] = [];

  if (before.canceled !== after.canceled) {
    summaryLines.push(
      after.canceled ? "This event was canceled." : "This event is no longer canceled."
    );
  }

  const beforeStart = formatDateTime(before.startTime);
  const afterStart = formatDateTime(after.startTime);
  const beforeEnd = formatDateTime(before.endTime);
  const afterEnd = formatDateTime(after.endTime);

  if (beforeStart !== afterStart || beforeEnd !== afterEnd) {
    if (afterStart && afterEnd) {
      summaryLines.push(`Time changed to ${afterStart} - ${afterEnd}.`);
    } else if (afterStart) {
      summaryLines.push(`Start time changed to ${afterStart}.`);
    } else if (afterEnd) {
      summaryLines.push(`End time changed to ${afterEnd}.`);
    }
  }

  const beforeLocation = formatLocation(before);
  const afterLocation = formatLocation(after);
  if (beforeLocation !== afterLocation) {
    if (afterLocation) {
      summaryLines.push(`Location changed to ${afterLocation}.`);
    } else {
      summaryLines.push("Location details were removed.");
    }
  }

  if (before.title !== after.title) {
    summaryLines.push(`Title changed to "${after.title}".`);
  }

  return summaryLines;
};

export const buildEventUpdateNotificationPayload = (
  before: EventUpdateSnapshot,
  after: EventUpdateSnapshot
): EventUpdateNotificationPayload | null => {
  const summaryLines = buildEventUpdateSummaryLines(before, after);

  if (summaryLines.length === 0) {
    return null;
  }

  const eventUrl = `${process.env.FRONTEND_URL}/events/list/search/${after.id}`;
  const subject = after.canceled
    ? `Event canceled: ${after.title}`
    : `Event updated: ${after.title}`;

  return {
    subject,
    notificationText: `${after.title} was updated.`,
    summaryLines,
    eventUrl,
  };
};
