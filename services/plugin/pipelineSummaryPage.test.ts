import assert from 'node:assert/strict';
import test from 'node:test';
import {decodePipelineCursor, encodePipelineCursor, pageLimit, pipelineDisplayStatus} from './pipelineSummaryPage.js';

test('cursor round trips nanosecond timestamps and rejects other targets, filters, kinds and invalid input', () => {
  const position = {id: 'a', createdAt: '2026-01-01T00:00:00.123456789Z', order: 2};
  const cursor = encodePipelineCursor(['jobs', 'attempt'], position);
  assert.deepEqual(decodePipelineCursor(cursor, ['jobs', 'attempt']), position);
  for (const binding of [['jobs','other'], ['attempts','attempt']]) assert.throws(() => decodePipelineCursor(cursor, binding), /Invalid/);
  for (const value of ['', '!', 'a'.repeat(2049), Buffer.from('{}').toString('base64url')]) assert.throws(() => decodePipelineCursor(value, []), /Invalid/);
  assert.equal(decodePipelineCursor(null, []), null);
  const zoned = {...position, createdAt: '2026-01-01T12:00:00.123456789Z[Europe/London]'};
  assert.deepEqual(decodePipelineCursor(encodePipelineCursor([], zoned), []), zoned);
});
test('page sizes cannot disable the bound', () => {
  for (const value of [0, -1, 51, 1.5, Infinity, NaN]) assert.throws(() => pageLimit(value, 10, 50), /Page size/);
  assert.equal(pageLimit(null, 10, 50), 10);
  assert.equal(pageLimit(50, 10, 50), 50);
});
test('authoritative display status accounts for omitted jobs and attempts with no jobs', () => {
  assert.equal(pipelineDisplayStatus('QUEUED', []), 'PENDING');
  assert.equal(pipelineDisplayStatus('SUCCEEDED', ['FAILED']), 'FAILED');
  assert.equal(pipelineDisplayStatus('SUCCEEDED', ['TIMED_OUT']), 'TIMED_OUT');
  assert.equal(pipelineDisplayStatus('CANCELLED', []), 'CANCELLED');
  assert.equal(pipelineDisplayStatus('FAILED', ['PENDING']), 'PENDING');
  assert.equal(pipelineDisplayStatus('FAILED', ['RUNNING']), 'RUNNING');
  assert.equal(pipelineDisplayStatus('SUCCEEDED', []), 'SUCCEEDED');
});
