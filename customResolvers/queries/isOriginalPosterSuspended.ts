import type {
  IssueModel,
  CommentModel,
  DiscussionModel,
  EventModel,
  ChannelModel
} from '../../ogm_types.js'
import { getActiveSuspension } from '../../rules/permission/getActiveSuspension.js'
import { resolveIssueTarget } from '../shared/resolveIssueTarget.js'

type Input = {
  Channel: ChannelModel
  Issue: IssueModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel
}

export default function getResolver (input: Input) {
  const { Issue, Event, Comment, Discussion } = input
  return async (parent: any, args: any, context: any, resolveInfo: any) => {
    const { issueId } = args
    if (!issueId) {
      throw new Error('All arguments (issueId) are required')
    }

    const target = await resolveIssueTarget({
      Issue,
      Comment,
      Discussion,
      Event,
      issueId,
    })

    const suspensionInfo = await getActiveSuspension({
      ogm: context.ogm,
      channelUniqueName: target.channelUniqueName,
      username: target.username,
      modProfileName: target.modProfileName,
    })

    return suspensionInfo.isSuspended
  }
}
