import type { Driver } from "neo4j-driver";
import type { PluginPipelineRun, DownloadableFile, UserUpdateInput, UserWhere } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
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
  claimNotification(pipelineId: string, timestamp: string): Promise<{pluginPipelineRuns: Array<{pipelineId: string}>}>;
  createNotification(input: {where: UserWhere; update: UserUpdateInput}): Promise<void>;
}
export function createPipelineNotificationRepository(driver: Driver): PipelineNotificationRepository {
  return {
    async findAttempt(pipelineId) {
      const r = await executeGeneratedOperation<{pluginPipelineRuns: PluginPipelineRun[]}>(driver,
        `query PipelineNotificationAttempt($where: PluginPipelineRunWhere) { pluginPipelineRuns(where: $where) ${PIPELINE_NOTIFICATION_ATTEMPT_SELECTION} }`, {where:{pipelineId}});
      return r.pluginPipelineRuns;
    },
    async findTargetFile(id) {
      const r = await executeGeneratedOperation<{downloadableFiles: DownloadableFile[]}>(driver,
        `query PipelineNotificationFile($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${PIPELINE_NOTIFICATION_FILE_SELECTION} }`, {where:{id}});
      return r.downloadableFiles;
    },
    async claimNotification(pipelineId, timestamp) {
      const r = await executeGeneratedOperation<{updatePluginPipelineRuns:{pluginPipelineRuns:Array<{pipelineId:string}>}}>(driver,
        `mutation ClaimPipelineNotification($where: PluginPipelineRunWhere, $update: PluginPipelineRunUpdateInput) { updatePluginPipelineRuns(where: $where, update: $update) { pluginPipelineRuns { pipelineId } } }`,
        {where:{pipelineId,notifiedAt:null},update:{notifiedAt:timestamp}});
      return r.updatePluginPipelineRuns;
    },
    async createNotification({where,update}) {
      await executeGeneratedOperation(driver,
        `mutation CreatePipelineResultNotification($where: UserWhere, $update: UserUpdateInput) { updateUsers(where:$where,update:$update) { users ${NOTIFICATION_USER_SELECTION} } }`,{where,update});
    },
  };
}
