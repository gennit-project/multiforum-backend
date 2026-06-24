import type { Driver } from 'neo4j-driver'
import type {
  ChannelModel,
  CommentModel,
  DiscussionModel,
  DownloadableFileModel,
  EventModel,
  IssueModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel,
  UserModel
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
    settingsJson: unknown
  }
  node: {
    id: string
    version: string
    repoUrl: string
    tarballGsUri: string
    entryPath: string
    manifest: unknown
    settingsDefaults: unknown
    uiSchema: unknown
    Plugin: {
      id: string
      name: string
      displayName: string
      description: string
      metadata: unknown
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
    Channel: ChannelModel
    Comment: CommentModel
    Discussion: DiscussionModel
    Event: EventModel
    Issue: IssueModel
    PluginRun: PluginRunModel
    ServerConfig: ServerConfigModel
    ServerSecret: ServerSecretModel
    User: UserModel
  }
  driver?: Driver
}

// Arguments for channel trigger
export type ChannelTriggerArgs = {
  discussionId: string
  channelUniqueName: string
  event: string
  models: Models & {
    Channel: ChannelModel
    Discussion: DiscussionModel
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
