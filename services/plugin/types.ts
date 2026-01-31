import type {
  DownloadableFileModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel
} from '../../ogm_types.js'

// Base Models type for server-scoped triggers
export type Models = {
  DownloadableFile: DownloadableFileModel
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  PluginRun: PluginRunModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

// Pipeline step configuration
export type PipelineStep = {
  pluginId: string
  version?: string  // Optional: specific version to use. If not specified, uses latest enabled version.
  continueOnError?: boolean
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
}

// Event pipeline configuration
export type EventPipeline = {
  event: string
  steps: PipelineStep[]
  stopOnFirstFailure?: boolean
}

// Plugin edge data from GraphQL connection
export type PluginEdgeData = {
  properties: {
    enabled: boolean
    settingsJson: any
  }
  node: {
    id: string
    version: string
    repoUrl: string
    tarballGsUri: string
    entryPath: string
    manifest: any
    settingsDefaults: any
    uiSchema: any
    Plugin: {
      id: string
      name: string
      displayName: string
      description: string
      metadata: any
    }
  }
}

// Arguments for downloadable file trigger
export type TriggerArgs = {
  downloadableFileId: string
  event: string
  models: Models
}

// Arguments for comment trigger
export type CommentTriggerArgs = {
  commentId: string
  event: string
  models: {
    Channel: any
    Comment: any
    PluginRun: PluginRunModel
    ServerConfig: ServerConfigModel
    ServerSecret: ServerSecretModel
    User: any
  }
}

// Arguments for channel trigger
export type ChannelTriggerArgs = {
  discussionId: string
  channelUniqueName: string
  event: string
  models: Models & {
    Channel: any
    Discussion: any
  }
}

// Internal type for plugins to run in a pipeline
export type PluginToRun = {
  pluginId: string
  edgeData: PluginEdgeData
  step: PipelineStep
  order: number
}

// Pending run record
export type PendingRun = {
  id: string
  pluginId: string
  order: number
}
