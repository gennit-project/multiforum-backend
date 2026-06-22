import { DateTime } from "luxon";


export const timeFrameOptions = {
  // Conversion to UTC is required for the time comparison
  // to be in a consistent timezone.
  day: {
    start: DateTime.local().minus({ days: 1 }).toUTC().toISO(),
  },
  week: {
    start: DateTime.local().minus({ weeks: 1 }).toUTC().toISO(),
  },
  month: {
    start: DateTime.local().minus({ months: 1 }).toUTC().toISO(),
  },
  year: {
    start: DateTime.local().minus({ years: 1 }).toUTC().toISO(),
  },
}