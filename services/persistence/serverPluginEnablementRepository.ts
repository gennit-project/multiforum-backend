import type { Driver } from 'neo4j-driver'
import type { Plugin, PluginVersion, ServerSecret } from '../../ogm_types.js'
import { executeGeneratedOperation } from './generatedSchemaOperations.js'

type PluginSnapshot = Pick<Plugin, 'id'|'name'|'displayName'|'description'|'authorName'|'authorUrl'|'homepage'|'license'|'tags'|'metadata'> & {Versions?: Array<Pick<PluginVersion,'id'|'version'|'manifest'|'settingsDefaults'|'uiSchema'|'documentationPath'|'readmeMarkdown'|'registryUrl'|'releaseNotesUrl'|'sourceRepoUrl'|'sourceCommit'|'minServerVersion'|'apiVersion'>>}
type InstallationSnapshot = {serverName?:string|null;InstalledVersions:Array<{id:string;version:string}>;InstalledVersionsConnection?:{edges?:Array<{properties?:{settingsJson?:unknown}|null}>}|null}
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
          Versions(where: { version: $version }) {
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
          InstalledVersions(where: { id: $id }) {
            id
            version
          }
          InstalledVersionsConnection(where: { node: { id: $id } }) {
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
  async findPlugin(pluginId,version){return(await executeGeneratedOperation<{plugins:PluginSnapshot[]}>(driver,PLUGIN,{where:{name:pluginId},version})).plugins;},
  async findInstallations(id){return(await executeGeneratedOperation<{serverConfigs:InstallationSnapshot[]}>(driver,INSTALLATIONS,{id})).serverConfigs;},
  async findSecrets(pluginId){return(await executeGeneratedOperation<{serverSecrets:Awaited<ReturnType<ServerPluginEnablementRepository['findSecrets']>>}>(driver,SECRETS,{where:{pluginId}})).serverSecrets;},
  async setInstallation(serverName,id,enabled,settingsJson){await executeGeneratedOperation(driver,SAVE,{where:{serverName},update:{InstalledVersions:[{where:{node:{id}},update:{edge:{enabled,settingsJson}}}]}});}
 };
}
