import { run, seedModerator } from './imageModerationHarness.js'

export type ServerSuspensionTarget = 'user' | 'mod'

export type ServerSuspensionScenario = {
  channelUniqueName: string
  contentId: string
  issueId: string
  issueNumber: number
  targetName: string
  targetUsername: string
}

/**
 * Seeds a realistic server-scoped moderation issue.
 *
 * The reported content belongs to a forum, but the Issue deliberately has no
 * HAS_ISSUE relationship to that Channel. That is the production distinction
 * between a server-scoped moderation action and a channel-scoped one.
 */
export async function seedServerSuspensionScenario(
  target: ServerSuspensionTarget
): Promise<ServerSuspensionScenario> {
  const channelUniqueName = 'cats'

  if (target === 'user') {
    const scenario = {
      channelUniqueName,
      contentId: 'reported-discussion',
      issueId: 'srv-user-issue',
      issueNumber: 1,
      targetName: 'baduser',
      targetUsername: 'baduser',
    }

    await run(
      `CREATE (channel:Channel {
         uniqueName: $channelUniqueName,
         createdAt: datetime()
       })
       CREATE (author:User {
         username: $targetUsername,
         displayName: 'Bad User',
         createdAt: datetime()
       })
       CREATE (discussion:Discussion {
         id: $contentId,
         title: 'Reported discussion',
         body: 'Content reported for a server rule violation.',
         createdAt: datetime(),
         hasSensitiveContent: false
       })
       CREATE (discussionChannel:DiscussionChannel {
         id: 'reported-discussion-in-cats',
         channelUniqueName: $channelUniqueName,
         createdAt: datetime(),
         archived: false
       })
       CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
       CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(discussion)
       CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
       CREATE (:Issue {
         id: $issueId,
         issueNumber: $issueNumber,
         channelUniqueName: '',
         isOpen: true,
         relatedDiscussionId: $contentId,
         relatedUsername: $targetUsername,
         title: 'Server report against baduser',
         body: 'Review the attached discussion.',
         authorName: 'Mod One',
         flaggedServerRuleViolation: true,
         createdAt: datetime()
       })`,
      scenario
    )

    return scenario
  }

  const scenario = {
    channelUniqueName,
    contentId: 'reported-mod-comment',
    issueId: 'srv-mod-issue',
    issueNumber: 2,
    targetName: 'BadMod',
    targetUsername: 'badmoduser',
  }

  await seedModerator({
    username: scenario.targetUsername,
    modDisplayName: scenario.targetName,
    email: 'badmod@e2e.test',
  })
  await run(
    `CREATE (channel:Channel {
       uniqueName: $channelUniqueName,
       createdAt: datetime()
     })
     CREATE (discussion:Discussion {
       id: 'mod-comment-discussion',
       title: 'Discussion containing the reported mod comment',
       body: 'Discussion body',
       createdAt: datetime(),
       hasSensitiveContent: false
     })
     CREATE (discussionChannel:DiscussionChannel {
       id: 'mod-comment-discussion-in-cats',
       channelUniqueName: $channelUniqueName,
       createdAt: datetime(),
       archived: false
     })
     CREATE (comment:Comment {
       id: $contentId,
       text: 'Content reported from a moderator profile.',
       isRootComment: true,
       archived: false,
       createdAt: datetime()
     })
     WITH channel, discussion, discussionChannel, comment
     MATCH (profile:ModerationProfile { displayName: $targetName })
     CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (discussionChannel)-[:CONTAINS_COMMENT]->(comment)
     CREATE (profile)-[:AUTHORED_COMMENT]->(comment)
     CREATE (:Issue {
       id: $issueId,
       issueNumber: $issueNumber,
       channelUniqueName: '',
       isOpen: true,
       relatedCommentId: $contentId,
       relatedModProfileName: $targetName,
       title: 'Server report against BadMod',
       body: 'Review the attached moderator comment.',
       authorName: 'Mod One',
       flaggedServerRuleViolation: true,
       createdAt: datetime()
     })`,
    scenario
  )

  return scenario
}
