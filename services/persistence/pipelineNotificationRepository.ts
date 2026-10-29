import type { Driver } from "neo4j-driver";
import type { PluginPipelineRun, DownloadableFile } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { executeManagedWrite } from "../neo4jTransactions.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";
export const PIPELINE_NOTIFICATION_ATTEMPT_SELECTION = `{
      pipelineId targetId targetType status notifiedAt
    }`;
export const PIPELINE_NOTIFICATION_FILE_SELECTION = `{
      id uploadedByUsername
      Discussion {
        id title
        Author { username }
        DiscussionChannels { channelUniqueName archived }
      }
    }`;
export interface PipelineNotificationRepository {
  findAttempt(pipelineId: string): Promise<PluginPipelineRun[]>;
  findTargetFile(id: string): Promise<DownloadableFile[]>;
  deliver(input: {pipelineId: string; timestamp: string; targetId: string; username: string; text: string; link: string | null}): Promise<boolean>;
}
export function createPipelineNotificationRepository(driver: Driver): PipelineNotificationRepository {
  return {
    async findAttempt(pipelineId) {
      const r = await executeGeneratedOperation<{pluginPipelineRuns: PluginPipelineRun[]}>(driver,
        `query PipelineNotificationAttempt($where: PluginPipelineRunWhere) { pluginPipelineRuns(where: $where) ${PIPELINE_NOTIFICATION_ATTEMPT_SELECTION} }`, {where:{pipelineId:{eq:pipelineId}}});
      return r.pluginPipelineRuns;
    },
    async findTargetFile(id) {
      const r = await executeGeneratedOperation<{downloadableFiles: DownloadableFile[]}>(driver,
        `query PipelineNotificationFile($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${PIPELINE_NOTIFICATION_FILE_SELECTION} }`, {where:{id:{eq:id}}});
      return r.downloadableFiles;
    },
    async deliver(input) {
      const delivered = await executeManagedWrite(driver, async tx => {
        // Lock first, then recheck the marker. Reading it before taking the
        // lock lets concurrent callbacks both observe an unclaimed attempt.
        await tx.run(`MATCH (p:PluginPipelineRun {pipelineId: $pipelineId})
          SET p._notificationLock = true REMOVE p._notificationLock`, {pipelineId: input.pipelineId});
        const result = await tx.run(`
          MATCH (p:PluginPipelineRun {pipelineId: $pipelineId})
          WHERE p.notifiedAt IS NULL AND p.targetType = 'DownloadableFile'
            AND p.targetId = $targetId AND p.status IN ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED']
          MATCH (f:DownloadableFile {id: p.targetId}), (u:User {username: $username})
          CREATE (n:Notification {id: randomUUID(), createdAt: datetime(), read: false,
            notificationType: 'plugin_pipeline', text: $text, link: $link})
          CREATE (u)-[:HAS_NOTIFICATION]->(n)
          SET p.notifiedAt = datetime($timestamp), p.updatedAt = datetime()
          RETURN n.id AS id`, input);
        return result.records.length > 0;
      });
      if (delivered) {
        // Keep the historical default projection after commit: response errors
        // must not undo a delivered notification or make a retry deliver twice.
        await executeGeneratedOperation(driver,
          `query PipelineNotificationRecipient($where: UserWhere) { users(where: $where) ${NOTIFICATION_USER_SELECTION} }`,
          {where: {username: {eq: input.username}}});
      }
      return delivered;
    },
  };
}
