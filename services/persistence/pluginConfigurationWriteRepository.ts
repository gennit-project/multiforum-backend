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

const CONFIGURE_CHANNEL_PLUGIN = `mutation ConfigureChannelPlugin($where: ChannelWhere, $connect: ChannelConnectInput, $disconnect: ChannelDisconnectInput) {
  updateChannels(where: $where, connect: $connect, disconnect: $disconnect) { channels { uniqueName } }
}`

const pluginVersionWhere = (pluginId: string, version: string) => ({
  node: { Plugin: { name: pluginId }, version },
})

export const createPluginConfigurationWriteRepository = (
  driver: Driver,
  execute: ExecuteOperation = executeGeneratedOperation
): PluginConfigurationWriteRepository => ({
  async setRegistries(urls) {
    await execute(driver, SET_REGISTRIES, {
      where: {},
      update: { pluginRegistries: urls },
    })
  },
  async configureChannelPlugin(input) {
    const where = pluginVersionWhere(input.pluginId, input.version)
    await execute(driver, CONFIGURE_CHANNEL_PLUGIN, {
      where: { uniqueName: input.channelUniqueName },
      connect: input.enabled ? {
        EnabledPlugins: [{
          where,
          edge: {
            enabled: true,
            ...(input.settingsJson === undefined
              ? {}
              : { settingsJson: JSON.stringify(input.settingsJson) }),
          },
          overwrite: true,
        }],
      } : undefined,
      disconnect: input.enabled ? undefined : {
        EnabledPlugins: [{ where }],
      },
    })
  },
})
