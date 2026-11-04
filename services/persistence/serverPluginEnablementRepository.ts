import type { ENABLEMENT_PLUGINProjection, ENABLEMENT_INSTALLATIONProjection } from "../../customResolvers/contracts/pluginInstallationProjections.js";
import type { Driver } from 'neo4j-driver'
import type { ServerSecret } from '../../ogm_types.js'
import { executeGeneratedOperation } from './generatedSchemaOperations.js'

type PluginSnapshot = ENABLEMENT_PLUGINProjection;
type InstallationSnapshot = ENABLEMENT_INSTALLATIONProjection;
export interface ServerPluginEnablementRepository {
 findPlugin(pluginId:string,version:string):Promise<PluginSnapshot[]>;
 findInstallations(id:string):Promise<InstallationSnapshot[]>;
 findSecrets(pluginId:string):Promise<Array<Pick<ServerSecret,'key'|'isValid'|'validationError'|'lastValidatedAt'>>>;
 setInstallation(serverName:string|null|undefined,id:string,enabled:boolean,settingsJson:string|null):Promise<void>;
}
// Approved correction: version and stored IDs are literal GraphQL variables.
export const ENABLEMENT_PLUGIN_SELECTION = `{
          id
          name
          displayName
          description
          authorName
          authorUrl
          homepage
          license
          tags
          metadata
          Versions(where: { version: { eq: $version } }) {
            id
            version
            manifest
            settingsDefaults
            uiSchema
            documentationPath
            readmeMarkdown
            registryUrl
            releaseNotesUrl
            sourceRepoUrl
            sourceCommit
            minServerVersion
            apiVersion
          }
        }`
export const ENABLEMENT_INSTALLATION_SELECTION = `{
          serverName
          InstalledVersions(where: { id: { eq: $id } }) {
            id
            version
          }
          InstalledVersionsConnection(where: { node: { id: { eq: $id } } }) {
            edges { properties { settingsJson } }
          }
        }`
export const ENABLEMENT_SERVER_DEFAULT_SELECTION = `{ serverName serverDescription serverIconURL allowedFileTypes featuredWikiPageIds enableDownloads enableEvents accountAgeGateEnabled minimumAccountAge sensitiveContentAgeGateEnabled minimumSensitiveContentAge brandingProductName brandingDocsURL brandingSourceURL brandingIssuesURL brandingSupportEmail brandingShowUpstreamLinks brandingLogoDarkURL brandingLogoAlt brandingFaviconURL brandingPrimaryColor pluginRegistries rules brandingCustomFooterLinks pluginPipelines }`
const PLUGIN = `query EnablementPlugin($where:PluginWhere,$version:String!){plugins(where:$where) ${ENABLEMENT_PLUGIN_SELECTION}}`
const INSTALLATIONS = `query EnablementInstallations($id:ID!){serverConfigs ${ENABLEMENT_INSTALLATION_SELECTION}}`
const SECRETS = `query EnablementSecrets($where:ServerSecretWhere){serverSecrets(where:$where){key isValid validationError lastValidatedAt}}`
const SAVE = `mutation SetServerPluginEnablement($where:ServerConfigWhere,$update:ServerConfigUpdateInput){updateServerConfigs(where:$where,update:$update){serverConfigs ${ENABLEMENT_SERVER_DEFAULT_SELECTION}}}`
export function createServerPluginEnablementRepository(driver:Driver):ServerPluginEnablementRepository {
 return {
  async findPlugin(pluginId,version){return(await executeGeneratedOperation<{plugins:PluginSnapshot[]}>(driver,PLUGIN,{where:{name:{eq:pluginId}},version})).plugins;},
  async findInstallations(id){return(await executeGeneratedOperation<{serverConfigs:InstallationSnapshot[]}>(driver,INSTALLATIONS,{id})).serverConfigs;},
  async findSecrets(pluginId){return(await executeGeneratedOperation<{serverSecrets:Awaited<ReturnType<ServerPluginEnablementRepository['findSecrets']>>}>(driver,SECRETS,{where:{pluginId:{eq:pluginId}}})).serverSecrets;},
  async setInstallation(serverName,id,enabled,settingsJson){await executeGeneratedOperation(driver,SAVE,{where:{serverName:{eq:serverName}},update:{InstalledVersions:[{update:{where:{node:{id:{eq:id}}},edge:{enabled:{set:enabled},settingsJson:{set:settingsJson}}}}]}});}
 };
}
