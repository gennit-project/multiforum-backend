import { int, type Driver, type Integer, type Record as Neo4jRecord } from 'neo4j-driver'

export type QueuedEventAttempt = {
  pipelineId: string
  targetId: string
  targetType: 'Comment' | 'Discussion'
  targetVersion?: string | null
  eventType: string
  channelId?: string | null
  configurationSnapshot: unknown
}

export type QueuedEventRun = {
  id: string
  pluginId: string
  version: string
  status: string
  executionOrder: number
  ruleSetVersion?: string | null
  targetVersion?: string | null
}

export type PluginEventQueueCapacity = {
  runningCount: number
  recentStartCount: number
}

export interface PluginEventQueueRepository {
  getCapacity(windowStart: string): Promise<PluginEventQueueCapacity>
  findQueuedAttempts(limit: number): Promise<QueuedEventAttempt[]>
  findRuns(pipelineId: string): Promise<QueuedEventRun[]>
  failPendingAttempt(pipelineId: string, message: string, finishedAt: string): Promise<void>
}

const EVENT_TYPES = [
  'comment.created',
  'comment.edited',
  'discussionChannel.created',
  'discussionChannel.edited',
]

const asNumber = (value: Integer | number) =>
  typeof value === 'number' ? value : value.toNumber()

const properties = <T>(record: Neo4jRecord, key: string): T =>
  record.get(key) as T

export const createPluginEventQueueRepository = (
  driver: Driver
): PluginEventQueueRepository => ({
  async getCapacity(windowStart) {
    const result = await driver.executeQuery(
      `MATCH (job:PluginRun)
       WHERE job.deferred = true
         AND job.targetType IN ['Comment', 'Discussion']
         AND job.eventType IN $eventTypes
       RETURN count(CASE WHEN job.status = 'RUNNING' THEN 1 END) AS runningCount,
              count(CASE WHEN job.startedAt >= datetime($windowStart) THEN 1 END) AS recentStartCount`,
      { eventTypes: EVENT_TYPES, windowStart }
    )
    const record = result.records[0]
    return {
      runningCount: asNumber(record.get('runningCount')),
      recentStartCount: asNumber(record.get('recentStartCount')),
    }
  },

  async findQueuedAttempts(limit) {
    const result = await driver.executeQuery(
      `MATCH (attempt:PluginPipelineRun {status: 'QUEUED', trigger: 'EVENT'})
       MATCH (pendingJob:PluginRun {status: 'PENDING', deferred: true})
       WHERE attempt.targetType IN ['Comment', 'Discussion']
         AND attempt.eventType IN $eventTypes
         AND pendingJob.pipelineId = attempt.pipelineId
       WITH DISTINCT attempt
       ORDER BY attempt.queuedAt ASC, attempt.createdAt ASC, attempt.pipelineId ASC
       LIMIT $limit
       RETURN attempt {
         .pipelineId, .targetId, .targetType, .targetVersion, .eventType,
         .channelId, .configurationSnapshot
       } AS attempt`,
      { eventTypes: EVENT_TYPES, limit: int(limit) }
    )
    return result.records.map(record => properties<QueuedEventAttempt>(record, 'attempt'))
  },

  async findRuns(pipelineId) {
    const result = await driver.executeQuery(
      `MATCH (job:PluginRun {pipelineId: $pipelineId})
       RETURN job {
         .id, .pluginId, .version, .status, .executionOrder,
         .ruleSetVersion, .targetVersion
       } AS job
       ORDER BY job.executionOrder ASC, job.createdAt ASC`,
      { pipelineId }
    )
    return result.records.map(record => {
      const job = properties<Omit<QueuedEventRun, 'executionOrder'> & { executionOrder: Integer | number }>(record, 'job')
      return { ...job, executionOrder: asNumber(job.executionOrder) }
    })
  },

  async failPendingAttempt(pipelineId, message, finishedAt) {
    await driver.executeQuery(
      `MATCH (attempt:PluginPipelineRun {pipelineId: $pipelineId})
       WHERE attempt.status IN ['QUEUED', 'RUNNING']
       SET attempt.status = 'FAILED',
           attempt.finishedAt = datetime($finishedAt),
           attempt.timeoutAt = null
       WITH attempt
       MATCH (job:PluginRun {pipelineId: $pipelineId, status: 'PENDING'})
       SET job.status = 'FAILED',
           job.message = $message,
           job.finishedAt = datetime($finishedAt),
           job.timeoutAt = null`,
      { pipelineId, message, finishedAt }
    )
  },
})
