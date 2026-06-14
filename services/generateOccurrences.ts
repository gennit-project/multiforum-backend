/**
 * Utility functions for generating event occurrences from repeat patterns.
 * Used by the createEventSeries mutation to generate individual events.
 */

export type RepeatPatternType = 'MANUAL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RepeatEndType = 'NEVER' | 'AFTER_COUNT' | 'ON_DATE';

export interface RepeatPattern {
  type: RepeatPatternType;
  count?: number; // Every N days/weeks/months
  daysOfWeek?: number[]; // [0, 6] for weekends (0 = Sunday)
  endType: RepeatEndType;
  endCount?: number; // Number of occurrences
  endDate?: string; // End date ISO string
}

export interface DateOccurrence {
  startTime: string;
  endTime: string;
}

export interface GenerateOccurrencesInput {
  pattern: RepeatPattern;
  startTime: string; // First occurrence start time
  endTime: string; // First occurrence end time
  maxOccurrences?: number; // Safety limit, defaults to 100
}

// Maximum occurrences to prevent runaway generation
const DEFAULT_MAX_OCCURRENCES = 100;

// Maximum days into the future for NEVER end type
const MAX_FUTURE_DAYS = 365;

/**
 * Add days to a Date object
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add weeks to a Date object
 */
function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/**
 * Add months to a Date object
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add years to a Date object
 */
function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday)
 */
function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Check if a date is past the end condition
 */
function isPastEndCondition(
  date: Date,
  pattern: RepeatPattern,
  occurrenceCount: number,
  maxDate: Date
): boolean {
  if (pattern.endType === 'AFTER_COUNT') {
    return pattern.endCount ? occurrenceCount >= pattern.endCount : false;
  }

  if (pattern.endType === 'ON_DATE') {
    const endDate = pattern.endDate ? new Date(pattern.endDate) : maxDate;
    return date > endDate;
  }

  // NEVER: use maxDate as safety limit
  return date > maxDate;
}

/**
 * Generate the next date based on the repeat pattern
 */
function getNextDate(
  currentDate: Date,
  pattern: RepeatPattern
): Date {
  const interval = pattern.count || 1;

  switch (pattern.type) {
    case 'DAILY':
      return addDays(currentDate, interval);

    case 'WEEKLY':
      // If specific days of week are selected, find the next valid day
      if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
        return getNextWeeklyOccurrence(currentDate, pattern.daysOfWeek, interval);
      }
      return addWeeks(currentDate, interval);

    case 'MONTHLY':
      return addMonths(currentDate, interval);

    case 'YEARLY':
      return addYears(currentDate, interval);

    default:
      return addDays(currentDate, 1);
  }
}

/**
 * Get the next occurrence for weekly patterns with specific days of week
 */
function getNextWeeklyOccurrence(
  currentDate: Date,
  daysOfWeek: number[],
  weekInterval: number
): Date {
  const currentDay = getDayOfWeek(currentDate);
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);

  // Find the next day in the current week
  for (const day of sortedDays) {
    if (day > currentDay) {
      return addDays(currentDate, day - currentDay);
    }
  }

  // No more days this week - go to first day of next occurrence
  const daysUntilNextWeek = 7 - currentDay + (sortedDays[0] || 0);
  const daysToAdd = daysUntilNextWeek + (weekInterval - 1) * 7;
  return addDays(currentDate, daysToAdd);
}

/**
 * Apply the time from originalTime to targetDate
 */
function applyTimeToDate(targetDate: Date, originalTime: Date): Date {
  const result = new Date(targetDate);
  result.setHours(originalTime.getHours());
  result.setMinutes(originalTime.getMinutes());
  result.setSeconds(originalTime.getSeconds());
  result.setMilliseconds(originalTime.getMilliseconds());
  return result;
}

/**
 * Calculate the duration between two dates in milliseconds
 */
function getDurationMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime();
}

/**
 * Generate occurrences from a repeat pattern
 */
export function generateOccurrences(input: GenerateOccurrencesInput): DateOccurrence[] {
  const { pattern, startTime, endTime, maxOccurrences = DEFAULT_MAX_OCCURRENCES } = input;

  // Manual type means no automatic generation
  if (pattern.type === 'MANUAL') {
    return [{
      startTime,
      endTime,
    }];
  }

  const occurrences: DateOccurrence[] = [];
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const duration = getDurationMs(startDate, endDate);

  // Calculate max date for NEVER end type
  const maxDate = addDays(new Date(), MAX_FUTURE_DAYS);

  // For weekly patterns with specific days, check if start date matches
  if (pattern.type === 'WEEKLY' && pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const startDay = getDayOfWeek(startDate);
    if (!pattern.daysOfWeek.includes(startDay)) {
      // Start date doesn't match selected days - find first valid day
      let currentDate = startDate;
      currentDate = getNextWeeklyOccurrence(
        addDays(currentDate, -1), // Go back one day to include current week
        pattern.daysOfWeek,
        1
      );

      // If the found date is before or equal to start, skip to next
      if (currentDate <= startDate) {
        currentDate = getNextWeeklyOccurrence(currentDate, pattern.daysOfWeek, pattern.count || 1);
      }

      // Add this first valid occurrence
      const occStart = applyTimeToDate(currentDate, startDate);
      const occEnd = new Date(occStart.getTime() + duration);

      if (!isPastEndCondition(occStart, pattern, occurrences.length, maxDate)) {
        occurrences.push({
          startTime: occStart.toISOString(),
          endTime: occEnd.toISOString(),
        });
      }

      // Continue from here
      while (occurrences.length < maxOccurrences) {
        currentDate = getNextDate(currentDate, pattern);
        const nextStart = applyTimeToDate(currentDate, startDate);

        if (isPastEndCondition(nextStart, pattern, occurrences.length, maxDate)) {
          break;
        }

        const nextEnd = new Date(nextStart.getTime() + duration);
        occurrences.push({
          startTime: nextStart.toISOString(),
          endTime: nextEnd.toISOString(),
        });
      }

      return occurrences;
    }
  }

  // Add the first occurrence
  occurrences.push({
    startTime,
    endTime,
  });

  // Generate subsequent occurrences
  let currentDate = startDate;

  while (occurrences.length < maxOccurrences) {
    currentDate = getNextDate(currentDate, pattern);
    const nextStart = applyTimeToDate(currentDate, startDate);

    if (isPastEndCondition(nextStart, pattern, occurrences.length, maxDate)) {
      break;
    }

    const nextEnd = new Date(nextStart.getTime() + duration);
    occurrences.push({
      startTime: nextStart.toISOString(),
      endTime: nextEnd.toISOString(),
    });
  }

  return occurrences;
}

/**
 * Validate a repeat pattern
 */
export function validateRepeatPattern(pattern: RepeatPattern): {
  valid: boolean;
  error?: string;
} {
  if (!pattern.type) {
    return { valid: false, error: 'Pattern type is required' };
  }

  if (!['MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(pattern.type)) {
    return { valid: false, error: 'Invalid pattern type' };
  }

  if (!pattern.endType) {
    return { valid: false, error: 'End type is required' };
  }

  if (!['NEVER', 'AFTER_COUNT', 'ON_DATE'].includes(pattern.endType)) {
    return { valid: false, error: 'Invalid end type' };
  }

  if (pattern.endType === 'AFTER_COUNT') {
    if (!pattern.endCount || pattern.endCount < 1) {
      return { valid: false, error: 'End count must be at least 1' };
    }
    if (pattern.endCount > DEFAULT_MAX_OCCURRENCES) {
      return { valid: false, error: `End count cannot exceed ${DEFAULT_MAX_OCCURRENCES}` };
    }
  }

  if (pattern.endType === 'ON_DATE') {
    if (!pattern.endDate) {
      return { valid: false, error: 'End date is required' };
    }
    const endDate = new Date(pattern.endDate);
    if (isNaN(endDate.getTime())) {
      return { valid: false, error: 'Invalid end date' };
    }
  }

  if (pattern.count !== undefined && (pattern.count < 1 || pattern.count > 99)) {
    return { valid: false, error: 'Interval must be between 1 and 99' };
  }

  if (pattern.daysOfWeek) {
    for (const day of pattern.daysOfWeek) {
      if (day < 0 || day > 6) {
        return { valid: false, error: 'Days of week must be between 0 (Sunday) and 6 (Saturday)' };
      }
    }
  }

  return { valid: true };
}
