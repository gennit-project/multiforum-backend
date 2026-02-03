import {
  getCommentsQuery,
  getNewCommentsQuery
} from '../cypher/cypherQueries.js'
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

const discussionChannelSelectionSet = `
{
    id
    createdAt
    weightedVotesCount
    discussionId
    channelUniqueName
    emoji
    answered
    archived
    Channel {
        uniqueName
        feedbackEnabled
        Bots {
            username
            displayName
            botProfileId
            isDeprecated
        }
    }
    Discussion {
        id
        title
        Author {
            username
            displayName
            profilePicURL
            commentKarma
            createdAt
            discussionKarma
            ... on User {
                ServerRoles {
                  showAdminTag
                }
                ChannelRoles {
                  showModTag
                }
            }
        }
    }
    CommentsAggregate(where: { isFeedbackComment: false }) {
        count
    }
    UpvotedByUsers {
        username
    }
    UpvotedByUsersAggregate {
        count
    }
    Answers {
        id
        text
        createdAt
        CommentAuthor {
          ... on User {
              username
          }
          ... on ModerationProfile {
              displayName
          }
        }
    }
    SubscribedToNotifications {
        username
    }
}
`

type Input = {
  driver: any
  DiscussionChannel: any
}

type Args = {
  channelUniqueName: string
  discussionId: string
  modName: string
  offset: string
  limit: string
  sort: string
}

const getResolver = (input: Input) => {
  const { driver, DiscussionChannel } = input
  return async (parent: any, args: Args, context: any, info: any) => {
    const { channelUniqueName, discussionId, modName, offset, limit, sort } =
      args
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false
    });
    const loggedInUsername = context.user?.username || null;

    const session = driver.session()

    try {
      const result = await DiscussionChannel.find({
        where: {
          discussionId,
          channelUniqueName
        },
        // get everything about the DiscussionChannel
        // except the comments
        selectionSet: discussionChannelSelectionSet
      })

      if (result.length === 0) {
        // If no DiscussionChannel is found, return null and an empty array
        return {
          DiscussionChannel: null,
          Comments: []
        }
      }

      const discussionChannel = result[0]
      const discussionChannelId = discussionChannel.id

      // Filter SubscribedToNotifications to only show current user's subscription status
      if (loggedInUsername && discussionChannel.SubscribedToNotifications) {
        const isSubscribed = discussionChannel.SubscribedToNotifications.some((sub: any) => sub.username === loggedInUsername)
        discussionChannel.SubscribedToNotifications = isSubscribed ? [{ username: loggedInUsername }] : []
      } else {
        discussionChannel.SubscribedToNotifications = []
      }

      let commentsResult = []

      if (sort === 'new') {
        // if sort is "new", get the comments sorted by createdAt.
        commentsResult = await session.run(getNewCommentsQuery, {
          discussionChannelId,
          modName,
          offset: parseInt(offset, 10),
          limit: parseInt(limit, 10),
          loggedInUsername
        })

        commentsResult = commentsResult.records.map((record: any) => {
          return record.get('comment')
        })
      } else if (sort === 'top') {
        // if sort is "top", get the comments sorted by weightedVotesCount.
        // Treat a null weightedVotesCount as 0.
        commentsResult = await session.run(getCommentsQuery, {
          discussionChannelId,
          modName,
          offset: parseInt(offset, 10),
          limit: parseInt(limit, 10),
          sortOption: 'top',
          loggedInUsername
        })

        commentsResult = commentsResult.records.map((record: any) => {
          return record.get('comment')
        })
      } else {
        // if sort is "hot", get the comments sorted by hotness,
        // which takes into account both weightedVotesCount and createdAt.
        commentsResult = await session.run(getCommentsQuery, {
          discussionChannelId,
          modName,
          offset: parseInt(offset, 10),
          limit: parseInt(limit, 10),
          sortOption: 'hot',
          loggedInUsername
        })

        commentsResult = commentsResult.records.map((record: any) => {
          return record.get('comment')
        })
      }

      return {
        DiscussionChannel: discussionChannel,
        Comments: commentsResult
      }
    } catch (error: any) {
      console.error('Error getting comment section:', error)
      throw new Error(`Failed to fetch comment section. ${error.message}`)
    } finally {
      session.close()
    }
  }
}

export default getResolver
