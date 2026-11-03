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
    const channelWhere = { uniqueName: { eq: input.channelUniqueName } }
    const settingsJson = input.enabled && input.settingsJson !== undefined
      ? JSON.stringify(input.settingsJson)
      : undefined
    if (input.enabled) {
      // v7 connect uses CREATE, not MERGE. Connect only when this channel does
      // not already have the requested version, then update its edge in place.
      await execute(driver, CONFIGURE_CHANNEL_PLUGIN, {
        where: { ...channelWhere, EnabledPlugins: { none: where.node } },
        update: { EnabledPlugins: [{ connect: [{ where, edge: { enabled: true, ...(settingsJson === undefined ? {} : { settingsJson }) } }] }] },
      })
    }
    await execute(driver, CONFIGURE_CHANNEL_PLUGIN, {
      where: channelWhere,
      update: { EnabledPlugins: input.enabled
        ? [{ update: {
            where,
            edge: {
              enabled: { set: true },
              ...(settingsJson === undefined
                ? {}
                : { settingsJson: { set: settingsJson } }),
            },
          } }]
        : [{ disconnect: [{ where }] }],
      },
    })
  },
})
