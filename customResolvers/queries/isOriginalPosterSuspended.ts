import type {
  IssueModel,
  CommentModel,
  DiscussionModel,
  EventModel,
  User,
  ModerationProfile,
  ChannelModel
} from '../../ogm_types.js'

type Input = {
  Channel: ChannelModel
  Issue: IssueModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel
}

export default function getResolver (input: Input) {
  const { Issue, Event, Comment, Discussion, Channel } = input
  return async (parent: any, args: any, context: any, resolveInfo: any) => {
    const { issueId } = args
    if (!issueId) {
      throw new Error('All arguments (issueId) are required')
    }

    const issues = await Issue.find({
      where: {
        id: issueId
      },
      selectionSet: `{
          id
          channelUniqueName
          relatedEventId
          relatedDiscussionId
          relatedCommentId
        }`
    })

    if (!issues.length) {
      throw new Error(`Issue with ID ${issueId} not found`)
    }
    const issue = issues[0]

    let originalPoster: User | ModerationProfile | null | undefined = null

    if (issue.relatedEventId) {
      const events = await Event.find({
        where: {
          id: issue.relatedEventId
        },
        selectionSet: `{
                    id
                    Poster {
                        username
                    }
                }
                `
      })
      if (!events.length) {
        throw new Error(`Event with ID ${issue.relatedEventId} not found`)
      }
      const event = events[0]
      originalPoster = event.Poster
    }
    if (issue.relatedDiscussionId) {
      const discussions = await Discussion.find({
        where: {
          id: issue.relatedDiscussionId
        },
        selectionSet: `{
                    id
                    Author {
                        username
                    }
                }
                `
      })
      if (!discussions.length) {
        throw new Error(
          `Discussion with ID ${issue.relatedDiscussionId} not found`
        )
      }
      const discussion = discussions[0]
      originalPoster = discussion.Author
    }
    if (issue.relatedCommentId) {
      const comments = await Comment.find({
        where: {
          id: issue.relatedCommentId
        },
        selectionSet: `{
                    id
                    CommentAuthor {
                        ... on User {
                            username
                        }
                        ... on ModerationProfile {
                            displayName
                        }
                    }
                }
                `
      })
      if (!comments.length) {
        throw new Error(`Comment with ID ${issue.relatedCommentId} not found`)
      }
      const comment = comments[0]
      originalPoster = comment.CommentAuthor
    }
    if (!originalPoster) {
      return false
    }
    // Check for suspension with the original author username
    // and the given channel
    if ('username' in originalPoster && originalPoster.username) {
      const channelData = await Channel.find({
        where: {
          uniqueName: issue.channelUniqueName
        },
        selectionSet:`{
          SuspendedUsers(where: { username: "${originalPoster.username}" }) {
            id
          }
        }`
      })
      if (channelData && channelData[0].SuspendedUsers?.length > 0) {
        return true
      }
      return false
    }
    if ('displayName' in originalPoster && originalPoster.displayName) {
      const channelData = await Channel.find({
        where: {
          uniqueName: issue.channelUniqueName
        },
        selectionSet:`{
          SuspendedMods(where: { modProfileName: "${originalPoster.displayName}" }) {
            id
          }
        }`
      })
      if (channelData && channelData[0].SuspendedMods?.length > 0) {
        return true
      }
      return false
    }
  }
}
