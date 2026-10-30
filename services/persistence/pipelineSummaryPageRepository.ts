import fs from 'node:fs';
import neo4j, { type Driver } from 'neo4j-driver';
import {
  PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION,
  type PipelineAttemptRecord, type PluginJobRecord,
} from '../plugin/publicPipeline.js';

const projection = (selection: string) => selection.replace(/[{}]/g, '').trim().split(/\s+/).map(field => `.${field}`).join(', ');
const readQuery = (file: string) => fs.readFileSync(new URL(`../../customResolvers/cypher/${file}.cypher`, import.meta.url), 'utf8')
  .replace('ATTEMPT_FIELDS', projection(PUBLIC_PIPELINE_ATTEMPT_SELECTION))
  .replace('JOB_FIELDS', projection(PUBLIC_PLUGIN_JOB_SELECTION));
export const summaryPageQueries = {
  attempts: readQuery('pipelineSummaryAttemptsPage'),
  flags: readQuery('pipelineSummaryFlags'),
  jobs: readQuery('pipelineSummaryJobsPage'),
  attempt: readQuery('pipelineSummaryAttempt'),
};

/** Split the lexicographic cursor into two index ranges, each bounded before UNION. */
export function summaryAttemptsPageQuery(after: PagePosition | null): string {
  if (!after) return summaryPageQueries.attempts;
  const tied = summaryPageQueries.attempts.replace('// CURSOR_FILTER',
    'AND a.createdAt = datetime($afterCreatedAt) AND a.id < $afterId');
  const older = summaryPageQueries.attempts.replace('// CURSOR_FILTER',
    'AND a.createdAt < datetime($afterCreatedAt)');
  return `CALL { ${tied} UNION ALL ${older} }
    RETURN attempt ORDER BY attempt.createdAt DESC, attempt.id DESC LIMIT $limit`;
}

function normalizeRecord<T>(record: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key,
    neo4j.isInt(value) ? value.toNumber() : neo4j.isDateTime(value) ? value.toString() : value,
  ])) as T;
}
export type SummaryFilter = { targetId: string; targetType: string; scope: string | null; channelId: string | null; eventType: string | null };
export type PagePosition = { id: string; createdAt: string; order: number };
export type SummaryFlags = { hasActiveWork: boolean; hasFailedWork: boolean };
export type JobsPage = { jobs: PluginJobRecord[]; statuses: string[] };
export interface PipelineSummaryPageRepository {
  findAttempts(filter: SummaryFilter, limit: number, after: PagePosition | null): Promise<PipelineAttemptRecord[]>;
  findFlags(filter: SummaryFilter): Promise<SummaryFlags>;
  findAttempt(id: string): Promise<PipelineAttemptRecord | null>;
  findJobs(attempts: PipelineAttemptRecord[], limit: number, after: PagePosition | null): Promise<Map<string, JobsPage>>;
}
const positionParams = (after: PagePosition | null) => ({ afterId: after?.id ?? null, afterCreatedAt: after?.createdAt ?? null, afterOrder: after?.order ?? null });
export function createPipelineSummaryPageRepository(driver: Driver): PipelineSummaryPageRepository {
  // Default leader routing preserves the application's read-your-own-writes policy.
  const run = async (query: string, parameters: Record<string, unknown>) => {
    const session = driver.session();
    try { return await session.run(query, parameters); } finally { await session.close(); }
  };
  return {
    async findAttempts(filter, limit, after) {
      const result = await run(summaryAttemptsPageQuery(after), { ...filter, limit: neo4j.int(limit), ...positionParams(after) });
      return result.records.map(row => normalizeRecord<PipelineAttemptRecord>(row.get('attempt')));
    },
    async findFlags(filter) {
      const result = await run(summaryPageQueries.flags, filter);
      return { hasActiveWork: result.records[0].get('hasActiveWork'), hasFailedWork: result.records[0].get('hasFailedWork') };
    },
    async findAttempt(id) {
      const result = await run(summaryPageQueries.attempt, { id });
      return result.records.length ? normalizeRecord<PipelineAttemptRecord>(result.records[0].get('attempt')) : null;
    },
    async findJobs(attempts, limit, after) {
      if (!attempts.length) return new Map();
      const result = await run(summaryPageQueries.jobs, {
        attempts: attempts.map(({id, pipelineId, targetId, targetType, scope, channelId, eventType}) => ({id, pipelineId, targetId, targetType, scope, eventType, channelId: channelId ?? null})),
        limit: neo4j.int(limit), ...positionParams(after),
      });
      return new Map(result.records.map(row => [row.get('id'), {
        jobs: (row.get('jobs') as Record<string, unknown>[]).map(job => normalizeRecord<PluginJobRecord>(job)),
        statuses: row.get('statuses') as string[],
      }]));
    },
  };
}
