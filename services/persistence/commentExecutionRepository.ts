import type {Driver} from "neo4j-driver";
import type {PluginRunCreateInput,PluginRunUpdateInput} from "../../ogm_types.js";
import type {CommentExecutionChannel,CommentExecutionComment,ExecutionConfiguration,ExecutionReturnedRun,ExecutionSecret,CreatedExecutionRuns} from "../../customResolvers/contracts/pipelineExecutorProjections.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {PLUGIN_RUN_DEFAULT_SELECTION} from "./pipelineLeaseRepository.js";
export interface CommentExecutionRepository {
 findChannel(uniqueName:string):Promise<CommentExecutionChannel[]>;
 findComment(id:string):Promise<CommentExecutionComment[]>;
 findConfiguration():Promise<ExecutionConfiguration[]>;
 createPendingRuns(input:PluginRunCreateInput[]):Promise<CreatedExecutionRuns>;
 markSkippedRun(id:string,update:PluginRunUpdateInput):Promise<void>;
 findReturnedRun(id:string):Promise<ExecutionReturnedRun[]>;
 findSecrets(pluginId:string):Promise<ExecutionSecret[]>;
}
export const CHANNEL_SELECTION = `{
      uniqueName
      displayName
      description
      rules
      pluginPipelines
      EnabledPluginsConnection {
        edges {
          properties {
            enabled
            settingsJson
          }
          node {
            id
            version
            Plugin {
              id
              name
            }
          }
        }
      }
    }`;
export const COMMENT_SELECTION = `{
      id
      text
      botMentions
      isFeedbackComment
      createdAt
      CommentAuthor {
        ... on User {
          username
          displayName
          isBot
        }
        ... on ModerationProfile {
          displayName
          User {
            username
          }
        }
      }
      DiscussionChannel {
        id
        discussionId
        channelUniqueName
        Discussion {
          id
          title
          body
        }
      }
      Channel {
        uniqueName
        displayName
        description
        rules
      }
      Event {
        id
        title
        EventChannels {
          channelUniqueName
        }
      }
      Issue {
        id
      }
      ParentComment {
        id
      }
    }`;
export const CONFIGURATION_SELECTION = `{
      serverName
      rules
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          properties {
            enabled
            settingsJson
          }
          node {
            id
            version
            repoUrl
            tarballGsUri
            entryPath
            manifest
            settingsDefaults
            uiSchema
            Plugin {
              id
              name
              displayName
              description
              metadata
            }
          }
        }
      }
    }`;
export const RETURNED_RUN_SELECTION = `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder skippedReason
          createdAt updatedAt
        }`;
export const SECRET_SELECTION = `{
          key
          ciphertext
        }`;
export function createCommentExecutionRepository(driver:Driver):CommentExecutionRepository {
 return {
 async findChannel(uniqueName){const r=await executeGeneratedOperation<{channels:CommentExecutionChannel[]}>(driver,`query CommentExecutionChannel($where:ChannelWhere){channels(where:$where)${CHANNEL_SELECTION}}`,{where:{uniqueName:{eq:uniqueName}}});return r.channels;},
 async findComment(id){const r=await executeGeneratedOperation<{comments:CommentExecutionComment[]}>(driver,`query CommentExecutionComment($where:CommentWhere){comments(where:$where)${COMMENT_SELECTION}}`,{where:{id:{eq:id}}});return r.comments;},
 async findConfiguration(){const r=await executeGeneratedOperation<{serverConfigs:ExecutionConfiguration[]}>(driver,`query CommentExecutionConfiguration {serverConfigs${CONFIGURATION_SELECTION}}`,{});return r.serverConfigs;},
 async createPendingRuns(input){const r=await executeGeneratedOperation<{createPluginRuns:CreatedExecutionRuns}>(driver,`mutation CreatePendingCommentJobs($input:[PluginRunCreateInput!]!){createPluginRuns(input:$input){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{input});return r.createPluginRuns;},
 async markSkippedRun(id,update){await executeGeneratedOperation(driver,`mutation SkipCommentJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]))});},
 async findReturnedRun(id){const r=await executeGeneratedOperation<{pluginRuns:ExecutionReturnedRun[]}>(driver,`query ReturnedCommentJob($where:PluginRunWhere){pluginRuns(where:$where)${RETURNED_RUN_SELECTION}}`,{where:{id:{eq:id}}});return r.pluginRuns;},
 async findSecrets(pluginId){const r=await executeGeneratedOperation<{serverSecrets:ExecutionSecret[]}>(driver,`query CommentExecutionSecrets($where:ServerSecretWhere){serverSecrets(where:$where)${SECRET_SELECTION}}`,{where:{pluginId:{eq:pluginId}}});return r.serverSecrets;},
 };
}
