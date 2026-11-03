import type { Driver } from 'neo4j-driver'
import { executeGeneratedOperation } from './generatedSchemaOperations.js'

export type ChannelPluginConfiguration = {
  channelUniqueName: string
  pluginId: string
  version: string
  enabled: boolean
  settingsJson?: Record<string, unknown>
}

export interface PluginConfigurationWriteRepository {
  setRegistries(urls: string[]): Promise<void>
  configureChannelPlugin(input: ChannelPluginConfiguration): Promise<void>
}

type ExecuteOperation = (
  driver: Driver,
  source: string,
  variables: Record<string, unknown>
) => Promise<unknown>

const SET_REGISTRIES = `mutation SetPluginConfigurationRegistries($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {
  updateServerConfigs(where: $where, update: $update) { serverConfigs { serverName pluginRegistries } }
}`

const CONFIGURE_CHANNEL_PLUGIN = `mutation ConfigureChannelPlugin($where: ChannelWhere, $update: ChannelUpdateInput) {
  updateChannels(where: $where, update: $update) { channels { uniqueName } }
}`

// Neo4j GraphQL v7 removed the top-level connect/disconnect arguments from
// update mutations and the generic scalar-equality shorthand. Relationship
// edits nest inside `update`, and scalar filters use `{ eq: ... }`.
const pluginVersionWhere = (pluginId: string, version: string) => ({
  node: { Plugin: { name: { eq: pluginId } }, version: { eq: version } },
})

export const createPluginConfigurationWriteRepository = (
  driver: Driver,
  execute: ExecuteOperation = executeGeneratedOperation
): PluginConfigurationWriteRepository => ({
  async setRegistries(urls) {
    await execute(driver, SET_REGISTRIES, {
      where: {},
      update: { pluginRegistries: { set: urls } },
    })
  },
  async configureChannelPlugin(input) {
    const where = pluginVersionWhere(input.pluginId, input.version)
    const enabledPlugins = input.enabled
      ? [{
          connect: [{
            where,
            edge: {
              enabled: true,
              ...(input.settingsJson === undefined
                ? {}
                : { settingsJson: JSON.stringify(input.settingsJson) }),
            },
          }],
        }]
      : [{ disconnect: [{ where }] }]
    await execute(driver, CONFIGURE_CHANNEL_PLUGIN, {
      where: { uniqueName: { eq: input.channelUniqueName } },
      update: { EnabledPlugins: enabledPlugins },
    })
  },
})
