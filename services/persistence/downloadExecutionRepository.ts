import type {Driver} from "neo4j-driver";
import type {DownloadableFile, DownloadableFileUpdateInput, ServerConfig, ServerSecret, PluginRun, PluginRunCreateInput, PluginRunUpdateInput, CreatePluginRunsMutationResponse} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {PLUGIN_RUN_DEFAULT_SELECTION} from "./pipelineLeaseRepository.js";
export interface DownloadExecutionRepository {
 findFile(id:string):Promise<DownloadableFile[]>;
 findConfiguration():Promise<ServerConfig[]>;
 writeScanState(id:string,update:Record<string,unknown>):Promise<void>;
 createPendingRuns(input:PluginRunCreateInput[]):Promise<CreatePluginRunsMutationResponse>;
 markSkippedRun(id:string,update:PluginRunUpdateInput):Promise<void>;
 findReturnedRun(id:string):Promise<PluginRun[]>;
 findSecrets(pluginId:string):Promise<ServerSecret[]>;
}
export const FILE_SELECTION = `{
      id
      fileName
      url
      kind
      size
      uploadedAt
      createdAt
      storageBucket
      storageObjectName
      Discussion {
        id
        title
        body
        DiscussionChannels {
          channelUniqueName
          Channel {
            uniqueName
            displayName
            description
            rules
          }
        }
      }
    }`;
export const CONFIGURATION_SELECTION = `{
      serverName
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
export function createDownloadExecutionRepository(driver:Driver):DownloadExecutionRepository {
 return {
 async findFile(id){const r=await executeGeneratedOperation<{downloadableFiles:DownloadableFile[]}>(driver,`query DownloadExecutionFile($where:DownloadableFileWhere){downloadableFiles(where:$where)${FILE_SELECTION}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findConfiguration(){const r=await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,`query DownloadExecutionConfiguration {serverConfigs${CONFIGURATION_SELECTION}}`,{});return r.serverConfigs;},
 async writeScanState(id,update){await executeGeneratedOperation(driver,`mutation WriteDownloadExecutionScanState($where:DownloadableFileWhere,$update:DownloadableFileUpdateInput){updateDownloadableFiles(where:$where,update:$update){downloadableFiles${FILE_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]))});},
 async createPendingRuns(input){const r=await executeGeneratedOperation<{createPluginRuns:CreatePluginRunsMutationResponse}>(driver,`mutation CreatePendingDownloadJobs($input:[PluginRunCreateInput!]!){createPluginRuns(input:$input){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{input});return r.createPluginRuns;},
 async markSkippedRun(id,update){await executeGeneratedOperation(driver,`mutation SkipDownloadJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]))});},
 async findReturnedRun(id){const r=await executeGeneratedOperation<{pluginRuns:PluginRun[]}>(driver,`query ReturnedDownloadJob($where:PluginRunWhere){pluginRuns(where:$where)${RETURNED_RUN_SELECTION}}`,{where:{id:{eq:id}}});return r.pluginRuns;},
 async findSecrets(pluginId){const r=await executeGeneratedOperation<{serverSecrets:ServerSecret[]}>(driver,`query DownloadExecutionSecrets($where:ServerSecretWhere){serverSecrets(where:$where)${SECRET_SELECTION}}`,{where:{pluginId:{eq:pluginId}}});return r.serverSecrets;},
 };
}
