MATCH (mod:ModerationProfile {displayName: $displayName})
WITH mod, date($startDate) AS startDate, date($endDate) AS endDate

// Moderation actions
OPTIONAL MATCH (mod)-[:PERFORMED_MODERATION_ACTION]->(action:ModerationAction)
WHERE date(datetime(action.createdAt)) >= startDate AND date(datetime(action.createdAt)) <= endDate
OPTIONAL MATCH (action)-[:MODERATED_COMMENT]->(actionComment:Comment)
OPTIONAL MATCH (issue:Issue)-[:ACTIVITY_ON_ISSUE]->(action)
OPTIONAL MATCH (relatedDiscussion:Discussion {id: issue.relatedDiscussionId})
OPTIONAL MATCH (relatedDiscussion)<-[:POSTED_IN_CHANNEL]-(relatedDiscussionChannel:DiscussionChannel)
OPTIONAL MATCH (relatedDiscussionChannel)-[:POSTED_IN_CHANNEL]->(relatedDiscussionChannelNode:Channel)
OPTIONAL MATCH (relatedEvent:Event {id: issue.relatedEventId})
OPTIONAL MATCH (relatedEvent)<-[:POSTED_IN_CHANNEL]-(relatedEventChannel:EventChannel)
OPTIONAL MATCH (relatedEventChannel)-[:POSTED_IN_CHANNEL]->(relatedEventChannelNode:Channel)
OPTIONAL MATCH (relatedComment:Comment {id: issue.relatedCommentId})
OPTIONAL MATCH (relatedComment)<-[:CONTAINS_COMMENT]-(relatedCommentDiscussionChannel:DiscussionChannel)
OPTIONAL MATCH (relatedCommentDiscussionChannel)-[:POSTED_IN_CHANNEL]->(relatedCommentDiscussionChannelNode:Channel)
OPTIONAL MATCH (relatedEventForComment:Event)-[:HAS_COMMENT]->(relatedComment)
OPTIONAL MATCH (relatedEventForComment)<-[:POSTED_IN_CHANNEL]-(relatedEventForCommentChannel:EventChannel)
OPTIONAL MATCH (relatedEventForCommentChannel)-[:POSTED_IN_CHANNEL]->(relatedEventForCommentChannelNode:Channel)
WITH mod, startDate, endDate,
  collect(
    CASE WHEN action IS NULL THEN null ELSE {
      id: action.id,
      actionType: action.actionType,
      actionDescription: action.actionDescription,
      createdAt: toString(action.createdAt),
      Comment: CASE WHEN actionComment IS NOT NULL THEN {
        id: actionComment.id,
        text: COALESCE(actionComment.text, ""),
        createdAt: toString(actionComment.createdAt)
      } ELSE null END,
      Issue: CASE WHEN issue IS NOT NULL THEN {
        id: issue.id,
        issueNumber: issue.issueNumber,
        channelUniqueName: issue.channelUniqueName,
        relatedDiscussionId: issue.relatedDiscussionId,
        relatedEventId: issue.relatedEventId,
        relatedCommentId: issue.relatedCommentId,
        title: issue.title,
        isOpen: issue.isOpen
      } ELSE null END,
      RelatedDiscussion: CASE WHEN relatedDiscussion IS NOT NULL THEN {
        id: relatedDiscussion.id,
        title: COALESCE(relatedDiscussion.title, ""),
        createdAt: toString(relatedDiscussion.createdAt),
        DiscussionChannels: CASE WHEN relatedDiscussionChannel IS NOT NULL THEN [{
          id: relatedDiscussionChannel.id,
          channelUniqueName: relatedDiscussionChannelNode.uniqueName,
          discussionId: relatedDiscussionChannel.discussionId
        }] ELSE [] END
      } ELSE null END,
      RelatedEvent: CASE WHEN relatedEvent IS NOT NULL THEN {
        id: relatedEvent.id,
        title: COALESCE(relatedEvent.title, ""),
        createdAt: toString(relatedEvent.createdAt),
        EventChannels: CASE WHEN relatedEventChannel IS NOT NULL THEN [{
          id: relatedEventChannel.id,
          channelUniqueName: relatedEventChannelNode.uniqueName,
          eventId: relatedEventChannel.eventId
        }] ELSE [] END
      } ELSE null END,
      RelatedComment: CASE WHEN relatedComment IS NOT NULL THEN {
        id: relatedComment.id,
        text: COALESCE(relatedComment.text, ""),
        createdAt: toString(relatedComment.createdAt),
        DiscussionChannel: CASE WHEN relatedCommentDiscussionChannel IS NOT NULL THEN {
          id: relatedCommentDiscussionChannel.id,
          discussionId: relatedCommentDiscussionChannel.discussionId,
          channelUniqueName: relatedCommentDiscussionChannelNode.uniqueName
        } ELSE null END,
        Event: CASE WHEN relatedEventForComment IS NOT NULL THEN {
          id: relatedEventForComment.id,
          title: COALESCE(relatedEventForComment.title, ""),
          createdAt: toString(relatedEventForComment.createdAt),
          EventChannels: CASE WHEN relatedEventForCommentChannel IS NOT NULL THEN [{
            id: relatedEventForCommentChannel.id,
            channelUniqueName: relatedEventForCommentChannelNode.uniqueName,
            eventId: relatedEventForCommentChannel.eventId
          }] ELSE [] END
        } ELSE null END
      } ELSE null END
    } END
  ) AS rawActionActivities
WITH mod, startDate, endDate,
  [a IN rawActionActivities WHERE a IS NOT NULL] AS actionActivities

// Feedback comments authored by the mod
OPTIONAL MATCH (mod)-[:AUTHORED_COMMENT]->(feedbackComment:Comment)
WHERE feedbackComment.isFeedbackComment = true
  AND date(datetime(feedbackComment.createdAt)) >= startDate
  AND date(datetime(feedbackComment.createdAt)) <= endDate
OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackDiscussion:Discussion)
OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackEvent:Event)
OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackOnComment:Comment)
OPTIONAL MATCH (feedbackDiscussion)<-[:POSTED_IN_CHANNEL]-(feedbackDiscussionChannel:DiscussionChannel)
OPTIONAL MATCH (feedbackDiscussionChannel)-[:POSTED_IN_CHANNEL]->(feedbackDiscussionChannelNode:Channel)
OPTIONAL MATCH (feedbackEvent)<-[:POSTED_IN_CHANNEL]-(feedbackEventChannel:EventChannel)
OPTIONAL MATCH (feedbackEventChannel)-[:POSTED_IN_CHANNEL]->(feedbackEventChannelNode:Channel)
OPTIONAL MATCH (feedbackOnComment)<-[:CONTAINS_COMMENT]-(feedbackOnCommentChannel:DiscussionChannel)
OPTIONAL MATCH (feedbackOnCommentChannel)-[:POSTED_IN_CHANNEL]->(feedbackOnCommentChannelNode:Channel)
OPTIONAL MATCH (feedbackEventForComment:Event)-[:HAS_COMMENT]->(feedbackOnComment)
OPTIONAL MATCH (feedbackEventForComment)<-[:POSTED_IN_CHANNEL]-(feedbackEventForCommentChannel:EventChannel)
OPTIONAL MATCH (feedbackEventForCommentChannel)-[:POSTED_IN_CHANNEL]->(feedbackEventForCommentChannelNode:Channel)
WITH actionActivities,
  collect(
    CASE WHEN feedbackComment IS NULL THEN null ELSE {
      id: feedbackComment.id,
      actionType: 'feedback',
      actionDescription: CASE
        WHEN feedbackDiscussion IS NOT NULL THEN 'Left feedback on a discussion'
        WHEN feedbackEvent IS NOT NULL THEN 'Left feedback on an event'
        WHEN feedbackOnComment IS NOT NULL THEN 'Left feedback on a comment'
        ELSE 'Left feedback'
      END,
      createdAt: toString(feedbackComment.createdAt),
      Comment: {
        id: feedbackComment.id,
        text: COALESCE(feedbackComment.text, ""),
        createdAt: toString(feedbackComment.createdAt)
      },
      Issue: null,
      RelatedDiscussion: CASE WHEN feedbackDiscussion IS NOT NULL THEN {
        id: feedbackDiscussion.id,
        title: COALESCE(feedbackDiscussion.title, ""),
        createdAt: toString(feedbackDiscussion.createdAt),
        DiscussionChannels: CASE WHEN feedbackDiscussionChannel IS NOT NULL THEN [{
          id: feedbackDiscussionChannel.id,
          channelUniqueName: feedbackDiscussionChannelNode.uniqueName,
          discussionId: feedbackDiscussionChannel.discussionId
        }] ELSE [] END
      } ELSE null END,
      RelatedEvent: CASE WHEN feedbackEvent IS NOT NULL THEN {
        id: feedbackEvent.id,
        title: COALESCE(feedbackEvent.title, ""),
        createdAt: toString(feedbackEvent.createdAt),
        EventChannels: CASE WHEN feedbackEventChannel IS NOT NULL THEN [{
          id: feedbackEventChannel.id,
          channelUniqueName: feedbackEventChannelNode.uniqueName,
          eventId: feedbackEventChannel.eventId
        }] ELSE [] END
      } ELSE null END,
      RelatedComment: CASE WHEN feedbackOnComment IS NOT NULL THEN {
        id: feedbackOnComment.id,
        text: COALESCE(feedbackOnComment.text, ""),
        createdAt: toString(feedbackOnComment.createdAt),
        DiscussionChannel: CASE WHEN feedbackOnCommentChannel IS NOT NULL THEN {
          id: feedbackOnCommentChannel.id,
          discussionId: feedbackOnCommentChannel.discussionId,
          channelUniqueName: feedbackOnCommentChannelNode.uniqueName
        } ELSE null END,
        Event: CASE WHEN feedbackEventForComment IS NOT NULL THEN {
          id: feedbackEventForComment.id,
          title: COALESCE(feedbackEventForComment.title, ""),
          createdAt: toString(feedbackEventForComment.createdAt),
          EventChannels: CASE WHEN feedbackEventForCommentChannel IS NOT NULL THEN [{
            id: feedbackEventForCommentChannel.id,
            channelUniqueName: feedbackEventForCommentChannelNode.uniqueName,
            eventId: feedbackEventForCommentChannel.eventId
          }] ELSE [] END
        } ELSE null END
      } ELSE null END
    } END
  ) AS rawFeedbackActivities
WITH actionActivities + [f IN rawFeedbackActivities WHERE f IS NOT NULL] AS allActivities
UNWIND allActivities AS activity
WITH date(datetime(activity.createdAt)) AS activityDate, collect(activity) AS activities
RETURN
  toString(activityDate) AS date,
  size(activities) AS count,
  activities
ORDER BY activityDate ASC
