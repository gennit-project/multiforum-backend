import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type {
  IssueModel,
  CommentModel,
  DiscussionModel,
  EventModel,
  ChannelModel,
  UserModel
} from '../../ogm_types.js'
import { getActiveSuspension } from '../../rules/permission/getActiveSuspension.js'
import { getActiveServerSuspension } from '../../rules/permission/getActiveServerSuspension.js'
import { resolveIssueTarget } from '../shared/resolveIssueTarget.js'

type Input = {
  Channel: ChannelModel
  Issue: IssueModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel
  User: UserModel
}

export default function getResolver (input: Input) {
  const { Issue, Event, Comment, Discussion, User } = input
  return async (parent: unknown, args: { issueId: string }, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { issueId } = args
    if (!issueId) {
      throw new Error('All arguments (issueId) are required')
    }

    const target = await resolveIssueTarget({
      Issue,
      Comment,
      Discussion,
      Event,
      User,
      issueId,
    })

    const suspensionInfo = target.scope === 'server'
      ? await getActiveServerSuspension({
          context,
          username: target.username,
          modProfileName: target.modProfileName,
        })
      : await getActiveSuspension({
          ogm: context.ogm,
          driver: context.driver,
          channelUniqueName: target.channelUniqueName as string,
          username: target.username,
          modProfileName: target.modProfileName,
        })

    return suspensionInfo.isSuspended
  }
}
