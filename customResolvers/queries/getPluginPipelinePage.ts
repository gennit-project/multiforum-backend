import type { Driver } from 'neo4j-driver';
import { createPipelineTargetRepository, type PipelineTargetRepository } from '../../services/persistence/pipelineTargetRepository.js';
import { createPipelineSummaryPageRepository, type PipelineSummaryPageRepository, type SummaryFilter, type JobsPage } from '../../services/persistence/pipelineSummaryPageRepository.js';
import { toPublicPipelineRun, type PipelineAttemptRecord } from '../../services/plugin/publicPipeline.js';
import { decodePipelineCursor, encodePipelineCursor, pageLimit, pipelineDisplayStatus } from '../../services/plugin/pipelineSummaryPage.js';
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js';

type Dependencies = { driver: Driver; pipelineTargetRepository?: PipelineTargetRepository; repository?: PipelineSummaryPageRepository };
export type SummaryPageArgs = { targetId: string; targetType: string; first?: number | null; after?: string | null; jobsFirst?: number | null; scope?: string | null; channelId?: string | null; eventType?: string | null };
const jobBinding = (id: string) => ['jobs', id];
function publicPage(attempt: PipelineAttemptRecord, page: JobsPage, first: number) {
  const jobs = page.jobs.slice(0, first);
  const last = jobs[jobs.length - 1];
  const displayStatus = pipelineDisplayStatus(attempt.status, page.statuses);
  return {
    run: toPublicPipelineRun({attempt, jobs}),
    displayStatus,
    hasActiveWork: displayStatus === 'PENDING' || displayStatus === 'RUNNING',
    jobsPageInfo: {
      hasNextPage: page.jobs.length > first,
      endCursor: last ? encodePipelineCursor(jobBinding(attempt.id), {id: last.id, createdAt: last.createdAt, order: last.executionOrder ?? 0}) : null,
    },
  };
}
export const createPipelineSummaryPage = ({driver, pipelineTargetRepository = createPipelineTargetRepository(driver), repository = createPipelineSummaryPageRepository(driver)}: Dependencies) =>
  async (_parent: unknown, args: SummaryPageArgs) => {
    const first = pageLimit(args.first, 10, 50);
    const jobsFirst = pageLimit(args.jobsFirst, 20, 100);
    if (args.scope != null && !['SERVER', 'CHANNEL'].includes(args.scope)) throw new Error('Invalid pipeline scope');
    if (args.channelId === '') throw new Error('Invalid pipeline channel');
    const filter: SummaryFilter = {targetId: args.targetId, targetType: args.targetType, scope: args.scope ?? null, channelId: args.channelId ?? null, eventType: args.eventType ?? null};
    const binding = ['attempts', filter];
    const after = decodePipelineCursor(args.after, binding);
    await assertPublicPipelineTargetVisible({repository: pipelineTargetRepository, targetId: args.targetId, targetType: args.targetType});
    const rows = await repository.findAttempts(filter, first + 1, after);
    const attempts = rows.slice(0, first);
    const flags = await repository.findFlags(filter);
    const jobs = await repository.findJobs(attempts, jobsFirst + 1, null);
    const last = attempts[attempts.length - 1];
    return {
      targetId: args.targetId, targetType: args.targetType, ...flags,
      pageInfo: {hasNextPage: rows.length > first, endCursor: last ? encodePipelineCursor(binding, {id: last.id, createdAt: last.createdAt, order: 0}) : null},
      attempts: attempts.map(attempt => publicPage(attempt, jobs.get(attempt.id) ?? {jobs: [], statuses: []}, jobsFirst)),
    };
  };
export const createPipelineRunPage = ({driver, pipelineTargetRepository = createPipelineTargetRepository(driver), repository = createPipelineSummaryPageRepository(driver)}: Dependencies) =>
  async (_parent: unknown, {pipelineRunId, first: input, after: cursor}: {pipelineRunId: string; first?: number | null; after?: string | null}) => {
    const first = pageLimit(input, 20, 100);
    const after = decodePipelineCursor(cursor, jobBinding(pipelineRunId));
    const attempt = await repository.findAttempt(pipelineRunId);
    if (!attempt) return null;
    await assertPublicPipelineTargetVisible({repository: pipelineTargetRepository, targetId: attempt.targetId, targetType: attempt.targetType});
    const jobs = await repository.findJobs([attempt], first + 1, after);
    return publicPage(attempt, jobs.get(attempt.id) ?? {jobs: [], statuses: []}, first);
  };
