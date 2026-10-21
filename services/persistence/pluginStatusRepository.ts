import type { Driver } from 'neo4j-driver'
import { executeGeneratedOperation } from './generatedSchemaOperations.js'

export interface PluginStatusRepository {
  findVersion(pluginId: string, version: string): Promise<Array<{ Versions?: Array<{ id: string; manifest?: unknown }> }>>
  findInstallation(versionId: string): Promise<Array<{ InstalledVersionsConnection?: { edges?: Array<{ properties?: { settingsJson?: unknown } }> } }>>
  findSecretStatuses(pluginId: string): Promise<Array<{ key: string; isValid?: boolean | null; lastValidatedAt?: unknown; validationError?: string | null }>>
}

// Values are deliberately variables: approved correction treats quotes and
// backslashes as data instead of allowing them to change selection text.
const VERSION = `query PluginStatusVersion($where: PluginWhere, $version: String!) {
  plugins(where: $where) { Versions(where: { version: $version }) { id manifest } }
}`
const INSTALLATION = `query PluginStatusInstallation($id: ID!) {
  serverConfigs { InstalledVersionsConnection(where: { node: { id: $id } }) {
    edges { properties { settingsJson } }
  } }
}`
const SECRETS = `query PluginStatusSecrets($where: ServerSecretWhere) {
  serverSecrets(where: $where) { key isValid lastValidatedAt validationError }
}`

export function createPluginStatusRepository(driver: Driver): PluginStatusRepository {
  return {
    async findVersion(pluginId, version) {
      const data = await executeGeneratedOperation<{ plugins: Awaited<ReturnType<PluginStatusRepository['findVersion']>> }>(driver, VERSION, { where: { name: pluginId }, version })
      return data.plugins
    },
    async findInstallation(id) {
      const data = await executeGeneratedOperation<{ serverConfigs: Awaited<ReturnType<PluginStatusRepository['findInstallation']>> }>(driver, INSTALLATION, { id })
      return data.serverConfigs
    },
    async findSecretStatuses(pluginId) {
      const data = await executeGeneratedOperation<{ serverSecrets: Awaited<ReturnType<PluginStatusRepository['findSecretStatuses']>> }>(driver, SECRETS, { where: { pluginId } })
      return data.serverSecrets
    }
  }
}
