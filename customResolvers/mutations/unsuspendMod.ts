import type { IssueModel, ChannelModel, ServerConfigModel } from "../../ogm_types.js";
import { createUnsuspendResolver } from './shared/createUnsuspendResolver.js'

type Input = {
  Issue: IssueModel
  Channel: ChannelModel
  ServerConfig: ServerConfigModel
}

export default function getResolver (input: Input) {
  const { Issue, Channel, ServerConfig } = input
  return createUnsuspendResolver({
    Issue,
    Channel,
    ServerConfig,
    issueRelatedAccountField: 'relatedModProfileName',
    channelSuspendedField: 'SuspendedMods',
    suspendedEntityName: 'mod',
    unsuspendCommentText: 'The mod has been suspended.'
  })
}
