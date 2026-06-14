import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  generateOccurrences,
  validateRepeatPattern,
  type RepeatPattern,
  type GenerateOccurrencesInput,
} from './generateOccurrences.js';

describe('generateOccurrences', () => {
  test('returns single occurrence for MANUAL pattern type', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'MANUAL',
        endType: 'NEVER',
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.startTime, '2024-12-12T09:00:00.000Z');
    assert.strictEqual(result[0]?.endTime, '2024-12-12T17:00:00.000Z');
  });

  test('generates daily occurrences with AFTER_COUNT end type', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'DAILY',
        count: 1,
        endType: 'AFTER_COUNT',
        endCount: 3,
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 3);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[1]?.startTime.includes('2024-12-13'));
    assert.ok(result[2]?.startTime.includes('2024-12-14'));
  });

  test('generates daily occurrences every 2 days', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'DAILY',
        count: 2,
        endType: 'AFTER_COUNT',
        endCount: 3,
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 3);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[1]?.startTime.includes('2024-12-14'));
    assert.ok(result[2]?.startTime.includes('2024-12-16'));
  });

  test('generates weekly occurrences', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'WEEKLY',
        count: 1,
        endType: 'AFTER_COUNT',
        endCount: 3,
      },
      startTime: '2024-12-12T09:00:00.000Z', // Thursday
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 3);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[1]?.startTime.includes('2024-12-19'));
    assert.ok(result[2]?.startTime.includes('2024-12-26'));
  });

  test('generates monthly occurrences', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'MONTHLY',
        count: 1,
        endType: 'AFTER_COUNT',
        endCount: 3,
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 3);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[1]?.startTime.includes('2025-01-12'));
    assert.ok(result[2]?.startTime.includes('2025-02-12'));
  });

  test('generates yearly occurrences', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'YEARLY',
        count: 1,
        endType: 'AFTER_COUNT',
        endCount: 3,
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 3);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[1]?.startTime.includes('2025-12-12'));
    assert.ok(result[2]?.startTime.includes('2026-12-12'));
  });

  test('stops at ON_DATE end condition', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'DAILY',
        count: 1,
        endType: 'ON_DATE',
        endDate: '2024-12-15T23:59:59.000Z',
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 4);
    assert.ok(result[0]?.startTime.includes('2024-12-12'));
    assert.ok(result[3]?.startTime.includes('2024-12-15'));
  });

  test('respects maxOccurrences limit', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'DAILY',
        count: 1,
        endType: 'NEVER',
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T17:00:00.000Z',
      maxOccurrences: 5,
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 5);
  });

  test('preserves event duration across occurrences', () => {
    const input: GenerateOccurrencesInput = {
      pattern: {
        type: 'DAILY',
        count: 1,
        endType: 'AFTER_COUNT',
        endCount: 2,
      },
      startTime: '2024-12-12T09:00:00.000Z',
      endTime: '2024-12-12T12:30:00.000Z', // 3.5 hour duration
    };

    const result = generateOccurrences(input);

    assert.strictEqual(result.length, 2);
    // Check second occurrence has same duration
    const start1 = new Date(result[0]!.startTime);
    const end1 = new Date(result[0]!.endTime);
    const start2 = new Date(result[1]!.startTime);
    const end2 = new Date(result[1]!.endTime);

    const duration1 = end1.getTime() - start1.getTime();
    const duration2 = end2.getTime() - start2.getTime();

    assert.strictEqual(duration1, duration2);
    assert.strictEqual(duration1, 3.5 * 60 * 60 * 1000); // 3.5 hours in ms
  });
});

describe('validateRepeatPattern', () => {
  test('validates a correct daily pattern', () => {
    const pattern: RepeatPattern = {
      type: 'DAILY',
      count: 1,
      endType: 'AFTER_COUNT',
      endCount: 5,
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, true);
  });

  test('validates a correct weekly pattern with days', () => {
    const pattern: RepeatPattern = {
      type: 'WEEKLY',
      count: 1,
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      endType: 'ON_DATE',
      endDate: '2025-01-01T00:00:00.000Z',
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, true);
  });

  test('rejects missing pattern type', () => {
    const pattern = {
      endType: 'NEVER',
    } as RepeatPattern;

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('type'));
  });

  test('rejects missing end type', () => {
    const pattern = {
      type: 'DAILY',
    } as RepeatPattern;

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('End type'));
  });

  test('rejects AFTER_COUNT without count', () => {
    const pattern: RepeatPattern = {
      type: 'DAILY',
      endType: 'AFTER_COUNT',
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('count'));
  });

  test('rejects ON_DATE without date', () => {
    const pattern: RepeatPattern = {
      type: 'DAILY',
      endType: 'ON_DATE',
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('date'));
  });

  test('rejects invalid day of week', () => {
    const pattern: RepeatPattern = {
      type: 'WEEKLY',
      daysOfWeek: [0, 7], // 7 is invalid
      endType: 'NEVER',
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('Days of week'));
  });

  test('rejects end count exceeding maximum', () => {
    const pattern: RepeatPattern = {
      type: 'DAILY',
      endType: 'AFTER_COUNT',
      endCount: 101, // Over 100
    };

    const result = validateRepeatPattern(pattern);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('exceed'));
  });
});
