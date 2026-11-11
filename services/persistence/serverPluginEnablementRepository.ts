import { compareVersions } from '../plugin/pipelineUtils.js'
import { preserveModerationGovernance } from '../plugin/reconcileModerationGovernance.js'
import { parseModerationSettings, supportsModerationPolicy } from '../plugin/moderationGovernance.js'
import { executeManagedWrite } from '../neo4jTransactions.js'
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
 setInstallation(serverName:string|null|undefined,id:string,enabled:boolean,settingsJson:string|null,moderationWrite?:true|'upgrade'):Promise<void|Record<string,unknown>>;
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
  async setInstallation(serverName,id,enabled,settingsJson,moderationWrite){
   if (moderationWrite) {
    return executeManagedWrite(driver,async tx=>{
     await tx.run('MATCH (s:ServerConfig {serverName:$serverName}) SET s._channelGovernanceLock=true REMOVE s._channelGovernanceLock',{serverName});
     const live=await tx.run('MATCH (:ServerConfig {serverName:$serverName})-[e:INSTALLED]->(v:PluginVersion {id:$id}) RETURN e.settingsJson AS settings,v.version AS version',{serverName,id});
     if (live.records.length !== 1) throw new Error('Plugin installation changed during reconciliation.');
     const governing=await tx.run('MATCH (:ServerConfig {serverName:$serverName})-[e:INSTALLED]->(v:PluginVersion)<-[:HAS_VERSION]-(:Plugin {name:"llm-moderation"}) WHERE e.enabled=true RETURN v.id AS id,v.version AS version,e.settingsJson AS settings',{serverName});
     const active=governing.records.map(row=>({id:String(row.get('id')),version:String(row.get('version')),settings:row.get('settings')})).sort((a,b)=>compareVersions(b.version,a.version));
     const current=active[0];
     const desired=parseModerationSettings(settingsJson);
     // The governing installation owns approvals across a version transition.
     // On the same version, explicit admin settings may revoke a grant; only
     // declarative reconciliation must retain its current grants unconditionally.
     const preserved=moderationWrite===true || (enabled && current && current.id!==id)
       ? preserveModerationGovernance(current?.settings ?? live.records[0].get('settings'),desired)
       : desired;
     if (enabled && !supportsModerationPolicy(String(live.records[0].get('version')),preserved)) throw new Error('Moderation governance requires plugin version 0.8.0 or later.')
     // A compatible downgrade/fallback remains governed by the retiring
     // higher version until this transaction. Carry grants made in that window
     // into the successor before atomically retiring the current governor.
     const successor=moderationWrite===true && !enabled && current?.id===id ? active.find(entry=>entry.id!==id) : undefined;
     if (successor) {
      const successorSettings=preserveModerationGovernance(current.settings,parseModerationSettings(successor.settings));
      if (supportsModerationPolicy(successor.version,successorSettings)) {
       await tx.run('MATCH (:ServerConfig {serverName:$serverName})-[e:INSTALLED]->(:PluginVersion {id:$id}) SET e.settingsJson=$settings',{serverName,id:successor.id,settings:JSON.stringify(successorSettings)});
      }
     }
     await tx.run('MATCH (:ServerConfig {serverName:$serverName})-[e:INSTALLED]->(:PluginVersion {id:$id}) SET e.enabled=$enabled,e.settingsJson=$settings',{serverName,id,enabled,settings:JSON.stringify(preserved)});
     return preserved;
    });
   }
   await executeGeneratedOperation(driver,SAVE,{where:{serverName:{eq:serverName}},update:{InstalledVersions:[{update:{where:{node:{id:{eq:id}}},edge:{enabled:{set:enabled},settingsJson:{set:settingsJson}}}}]}});
  }
 };
}
