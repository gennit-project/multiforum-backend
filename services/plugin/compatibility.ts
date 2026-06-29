import { compareVersions, type RegistryVersion } from './registryService.js'
import { CURRENT_SERVER_VERSION, SUPPORTED_PLUGIN_API_VERSION } from './constants.js'

export type PluginCompatibilityResult =
  | { compatible: true }
  | {
      compatible: false
      code: 'PLUGIN_VERSION_REQUIRES_NEWER_SERVER' | 'PLUGIN_API_VERSION_UNSUPPORTED'
      message: string
    }

export function getPluginVersionCompatibility(
  version: Pick<RegistryVersion, 'minServerVersion' | 'apiVersion'>,
  options: {
    currentServerVersion?: string
    supportedPluginApiVersion?: string
  } = {}
): PluginCompatibilityResult {
  const currentServerVersion = options.currentServerVersion || CURRENT_SERVER_VERSION
  const supportedPluginApiVersion = options.supportedPluginApiVersion || SUPPORTED_PLUGIN_API_VERSION

  if (version.minServerVersion && compareVersions(currentServerVersion, version.minServerVersion) < 0) {
    return {
      compatible: false,
      code: 'PLUGIN_VERSION_REQUIRES_NEWER_SERVER',
      message: `PLUGIN_VERSION_REQUIRES_NEWER_SERVER: Requires server >= ${version.minServerVersion}; current server is ${currentServerVersion}`
    }
  }

  if (version.apiVersion && version.apiVersion !== supportedPluginApiVersion) {
    return {
      compatible: false,
      code: 'PLUGIN_API_VERSION_UNSUPPORTED',
      message: `PLUGIN_API_VERSION_UNSUPPORTED: Requires plugin API ${version.apiVersion}; supported API is ${supportedPluginApiVersion}`
    }
  }

  return { compatible: true }
}
