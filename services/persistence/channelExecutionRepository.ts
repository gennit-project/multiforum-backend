import type {Driver} from "neo4j-driver";
import type {Channel, Discussion, DownloadableFileUpdateInput, ServerConfig, ServerSecret, PluginRun, PluginRunCreateInput, PluginRunUpdateInput, CreatePluginRunsMutationResponse} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {PLUGIN_RUN_DEFAULT_SELECTION} from "./pipelineLeaseRepository.js";
export interface ChannelExecutionRepository {
 findChannel(uniqueName:string):Promise<Channel[]>;
 findDiscussion(id:string):Promise<Discussion[]>;
 findConfiguration():Promise<ServerConfig[]>;
 writeScanState(id:string,update:Record<string,unknown>):Promise<void>;
 createPendingRuns(input:PluginRunCreateInput[]):Promise<CreatePluginRunsMutationResponse>;
 markSkippedRun(id:string,update:PluginRunUpdateInput):Promise<void>;
 findReturnedRun(id:string):Promise<PluginRun[]>;
 findSecrets(pluginId:string):Promise<ServerSecret[]>;
}
export const CHANNEL_SELECTION = `{
      uniqueName
      displayName
      description
      rules
      pluginPipelines
      Tags {
        text
      }
      FilterGroups(sort: [{ order: ASC }]) {
        id
        key
        displayName
        mode
        order
        options(sort: [{ order: ASC }]) {
          id
          value
          displayName
          order
        }
      }
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
export const DISCUSSION_SELECTION = `{
      id
      title
      body
      Author {
        username
        isBot
      }
      DownloadableFiles(limit: 1) {
        id
        fileName
        url
        kind
        size
        uploadedAt
        createdAt
        storageBucket
        storageObjectName
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
const FILE_DEFAULT_SELECTION = `{
  id
  fileName
  size
  url
  storageBucket
  storageObjectName
  storageUrl
  uploadedByUsername
  uploadedByIp
  permanentlyRemoved
  permanentlyRemovedByUsername
  permanentlyRemovedByModName
  priceCents
  priceCurrency
  stripeProductId
  stripePriceId
  downloadCountTotal
  downloadCountUnique
  attributionOverride
  supportPatreonUrl
  supportBuyMeACoffeeUrl
  supportKoFiUrl
  supportPayPalMeUrl
  scanReason
  reviewRequestReason
  reviewRequestedByUsername
  kind
  priceModel
  scanStatus
  uploadedAt
  createdAt
  permanentlyRemovedAt
  paywallExpiresAt
  scanCheckedAt
  reviewRequestedAt
}`;
export function createChannelExecutionRepository(driver:Driver):ChannelExecutionRepository {
 return {
 async findChannel(uniqueName){const r=await executeGeneratedOperation<{channels:Channel[]}>(driver,`query ChannelExecutionChannel($where:ChannelWhere){channels(where:$where)${CHANNEL_SELECTION}}`,{where:{uniqueName:{eq:uniqueName}}});return r.channels;},
 async findDiscussion(id){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query ChannelExecutionDiscussion($where:DiscussionWhere){discussions(where:$where)${DISCUSSION_SELECTION}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findConfiguration(){const r=await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,`query ChannelExecutionConfiguration {serverConfigs${CONFIGURATION_SELECTION}}`,{});return r.serverConfigs;},
 async writeScanState(id,update){await executeGeneratedOperation(driver,`mutation WriteChannelExecutionScanState($where:DownloadableFileWhere,$update:DownloadableFileUpdateInput){updateDownloadableFiles(where:$where,update:$update){downloadableFiles${FILE_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]))});},
 async createPendingRuns(input){const r=await executeGeneratedOperation<{createPluginRuns:CreatePluginRunsMutationResponse}>(driver,`mutation CreatePendingChannelJobs($input:[PluginRunCreateInput!]!){createPluginRuns(input:$input){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{input});return r.createPluginRuns;},
 async markSkippedRun(id,update){await executeGeneratedOperation(driver,`mutation SkipChannelJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]))});},
 async findReturnedRun(id){const r=await executeGeneratedOperation<{pluginRuns:PluginRun[]}>(driver,`query ReturnedChannelJob($where:PluginRunWhere){pluginRuns(where:$where)${RETURNED_RUN_SELECTION}}`,{where:{id:{eq:id}}});return r.pluginRuns;},
 async findSecrets(pluginId){const r=await executeGeneratedOperation<{serverSecrets:ServerSecret[]}>(driver,`query ChannelExecutionSecrets($where:ServerSecretWhere){serverSecrets(where:$where)${SECRET_SELECTION}}`,{where:{pluginId:{eq:pluginId}}});return r.serverSecrets;},
 };
}
