import type { ServerPipelineSettings } from "../../customResolvers/contracts/pluginPolicyProjections.js";
import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const SERVER_PIPELINE_UPDATE_SELECTION = `{ serverName serverDescription serverIconURL allowedFileTypes featuredWikiPageIds enableDownloads enableEvents accountAgeGateEnabled minimumAccountAge sensitiveContentAgeGateEnabled minimumSensitiveContentAge brandingProductName brandingDocsURL brandingSourceURL brandingIssuesURL brandingSupportEmail brandingShowUpstreamLinks brandingLogoDarkURL brandingLogoAlt brandingFaviconURL brandingPrimaryColor pluginRegistries rules brandingCustomFooterLinks pluginPipelines }`;
const CURRENT = `query ServerPipelineConfiguration { serverConfigs { serverName pluginPipelines } }`;
const SAVE = `mutation SaveServerPipelineConfiguration($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where: $where, update: $update) { serverConfigs ${SERVER_PIPELINE_UPDATE_SELECTION} } }`;
export interface ServerPipelineRepository {
  listCurrent(): Promise<ServerPipelineSettings[]>;
  save(serverName: string | null | undefined, pluginPipelines: string): Promise<void>;
}
export function createServerPipelineRepository(driver: Driver): ServerPipelineRepository {
  return {
    async listCurrent() {
      const data=await executeGeneratedOperation<{serverConfigs:ServerPipelineSettings[]}>(driver,CURRENT,{});
      return data.serverConfigs;
    },
    async save(serverName,pluginPipelines) {
      await executeGeneratedOperation(driver,SAVE,{where:{serverName:{eq:serverName}},update:{pluginPipelines:{set:pluginPipelines}}});
    },
  };
}
