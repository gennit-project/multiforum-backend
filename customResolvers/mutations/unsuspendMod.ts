import type {
  IssueModel,
  ChannelModel,
  EventModel,
  DiscussionModel,
  CommentModel,
  ServerConfigModel,
  UserModel
} from '../../ogm_types.js'
import { createUnsuspendResolver } from './shared/createUnsuspendResolver.js'

type Input = {
  Issue: IssueModel
  Channel: ChannelModel
  ServerConfig: ServerConfigModel
  Event: EventModel
  Comment: CommentModel
  Discussion: DiscussionModel
  User: UserModel
}

export default function getResolver (input: Input) {
  const { Issue, Channel, ServerConfig, Event, Comment, Discussion, User } = input
  return createUnsuspendResolver({
    Issue,
    Channel,
    ServerConfig,
    Comment,
    Discussion,
    Event,
    User,
    issueRelatedAccountField: 'relatedModProfileName',
    channelSuspendedField: 'SuspendedMods',
    suspendedEntityName: 'mod',
    unsuspendCommentText: 'The mod has been suspended.'
  })
}
