import { createHash } from 'node:crypto';
import type { PagePosition } from '../persistence/pipelineSummaryPageRepository.js';

export function pageLimit(value: number | null | undefined, fallback: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > max) throw new Error(`Page size must be an integer between 1 and ${max}`);
  return result;
}
const bindingKey = (binding: unknown) => createHash('sha256').update(JSON.stringify(binding)).digest('hex');
export function encodePipelineCursor(binding: unknown, position: PagePosition): string {
  return Buffer.from(JSON.stringify({ v: 1, binding: bindingKey(binding), ...position })).toString('base64url');
}
export function decodePipelineCursor(cursor: string | null | undefined, binding: unknown): PagePosition | null {
  if (cursor == null) return null;
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.v !== 1 || value.binding !== bindingKey(binding) || typeof value.id !== 'string' || !value.id || value.id.length > 512 ||
      typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})(?:\[[A-Za-z0-9_+\/-]+\])?$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt.replace(/\[[^\]]+\]$/, ''))) ||
      !Number.isSafeInteger(value.order)) throw new Error();
    return {id: value.id, createdAt: value.createdAt, order: value.order};
  } catch { throw new Error('Invalid pipeline page cursor'); }
}

/** Activity wins, then failures, then cancellation. Never infer success from a partial job page. */
export function pipelineDisplayStatus(attemptStatus: string, jobStatuses: string[]): string {
  const statuses = new Set([...jobStatuses, attemptStatus === 'QUEUED' ? 'PENDING' : attemptStatus]);
  return ['RUNNING', 'PENDING', 'FAILED', 'TIMED_OUT', 'CANCELLED'].find(status => statuses.has(status)) ?? (jobStatuses.length > 0 && jobStatuses.every(status => status === 'SKIPPED') ? 'SKIPPED' : 'SUCCEEDED');
}
