MATCH (mod:ModerationProfile {displayName: $displayName})
WITH mod, date($startDate) AS startDate, date($endDate) AS endDate

// Project moderation actions independently from feedback. Related channel
// collections are scoped so they cannot multiply the action rows.
CALL {
  WITH mod, startDate, endDate
  MATCH (mod)-[:PERFORMED_MODERATION_ACTION]->(action:ModerationAction)
  WHERE date(datetime(action.createdAt)) >= startDate
    AND date(datetime(action.createdAt)) <= endDate
  OPTIONAL MATCH (action)-[:MODERATED_COMMENT]->(actionComment:Comment)
  OPTIONAL MATCH (issue:Issue)-[:ACTIVITY_ON_ISSUE]->(action)
  OPTIONAL MATCH (relatedDiscussion:Discussion {id: issue.relatedDiscussionId})
  OPTIONAL MATCH (relatedEvent:Event {id: issue.relatedEventId})
  OPTIONAL MATCH (relatedComment:Comment {id: issue.relatedCommentId})

  CALL {
    WITH relatedDiscussion
    OPTIONAL MATCH (relatedDiscussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      channelUniqueName: channel.uniqueName,
      discussionId: dc.discussionId
    } END) WHERE entry IS NOT NULL] AS relatedDiscussionChannels
  }
  CALL {
    WITH relatedEvent
    OPTIONAL MATCH (relatedEvent)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN ec IS NULL THEN null ELSE {
      id: ec.id,
      channelUniqueName: channel.uniqueName,
      eventId: ec.eventId
    } END) WHERE entry IS NOT NULL] AS relatedEventChannels
  }
  CALL {
    WITH relatedComment
    OPTIONAL MATCH (relatedComment)<-[:CONTAINS_COMMENT]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN head([entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      discussionId: dc.discussionId,
      channelUniqueName: channel.uniqueName
    } END) WHERE entry IS NOT NULL]) AS relatedCommentDiscussionChannel
  }
  CALL {
    WITH relatedComment
    OPTIONAL MATCH (event:Event)-[:HAS_COMMENT]->(relatedComment)
    OPTIONAL MATCH (event)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    WITH event, [entry IN collect(DISTINCT CASE WHEN ec IS NULL THEN null ELSE {
      id: ec.id,
      channelUniqueName: channel.uniqueName,
      eventId: ec.eventId
    } END) WHERE entry IS NOT NULL] AS eventChannels
    RETURN head(collect(CASE WHEN event IS NULL THEN null ELSE {
      id: event.id,
      title: coalesce(event.title, ''),
      createdAt: toString(event.createdAt),
      EventChannels: eventChannels
    } END)) AS relatedCommentEvent
  }

  WITH action, actionComment, issue, relatedDiscussion, relatedEvent,
       relatedComment, relatedDiscussionChannels, relatedEventChannels,
       relatedCommentDiscussionChannel, relatedCommentEvent
  RETURN [entry IN collect(
    CASE WHEN NOT $mayAccessSensitiveContent AND (
      coalesce(relatedDiscussion.hasSensitiveContent, false) = true
      OR EXISTS { MATCH (actionComment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(actionDiscussion:Discussion) WHERE coalesce(actionDiscussion.hasSensitiveContent, false) = true }
      OR EXISTS { MATCH (actionComment)-[:HAS_FEEDBACK_COMMENT]->(:Comment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(actionDiscussion:Discussion) WHERE coalesce(actionDiscussion.hasSensitiveContent, false) = true }
      OR EXISTS { MATCH (relatedComment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(commentDiscussion:Discussion) WHERE coalesce(commentDiscussion.hasSensitiveContent, false) = true }
      OR EXISTS { MATCH (relatedComment)-[:HAS_FEEDBACK_COMMENT]->(commentDiscussion:Discussion) WHERE coalesce(commentDiscussion.hasSensitiveContent, false) = true }
      OR EXISTS { MATCH (relatedComment)-[:HAS_FEEDBACK_COMMENT]->(:Comment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(commentDiscussion:Discussion) WHERE coalesce(commentDiscussion.hasSensitiveContent, false) = true }
      OR EXISTS { MATCH (:Image {id: issue.relatedImageId, hasSensitiveContent: true}) }
    ) THEN null ELSE {
      id: action.id,
      actionType: action.actionType,
      actionDescription: action.actionDescription,
      createdAt: toString(action.createdAt),
      Comment: CASE WHEN actionComment IS NULL THEN null ELSE {
        id: actionComment.id,
        text: coalesce(actionComment.text, ''),
        createdAt: toString(actionComment.createdAt)
      } END,
      Issue: CASE WHEN issue IS NULL THEN null ELSE {
        id: issue.id,
        issueNumber: issue.issueNumber,
        channelUniqueName: issue.channelUniqueName,
        relatedDiscussionId: issue.relatedDiscussionId,
        relatedEventId: issue.relatedEventId,
        relatedCommentId: issue.relatedCommentId,
        title: issue.title,
        isOpen: issue.isOpen
      } END,
      RelatedDiscussion: CASE WHEN relatedDiscussion IS NULL THEN null ELSE {
        id: relatedDiscussion.id,
        title: coalesce(relatedDiscussion.title, ''),
        createdAt: toString(relatedDiscussion.createdAt),
        DiscussionChannels: relatedDiscussionChannels
      } END,
      RelatedEvent: CASE WHEN relatedEvent IS NULL THEN null ELSE {
        id: relatedEvent.id,
        title: coalesce(relatedEvent.title, ''),
        createdAt: toString(relatedEvent.createdAt),
        EventChannels: relatedEventChannels
      } END,
      RelatedComment: CASE WHEN relatedComment IS NULL THEN null ELSE {
        id: relatedComment.id,
        text: coalesce(relatedComment.text, ''),
        createdAt: toString(relatedComment.createdAt),
        DiscussionChannel: relatedCommentDiscussionChannel,
        Event: relatedCommentEvent
      } END
    } END
  ) WHERE entry IS NOT NULL] AS actionActivities
}

CALL {
  WITH mod, startDate, endDate
  MATCH (mod)-[:AUTHORED_COMMENT]->(feedbackComment:Comment)
  WHERE feedbackComment.isFeedbackComment = true
    AND date(datetime(feedbackComment.createdAt)) >= startDate
    AND date(datetime(feedbackComment.createdAt)) <= endDate
  OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackDiscussion:Discussion)
  OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackEvent:Event)
  OPTIONAL MATCH (feedbackComment)-[:HAS_FEEDBACK_COMMENT]->(feedbackOnComment:Comment)

  CALL {
    WITH feedbackDiscussion
    OPTIONAL MATCH (feedbackDiscussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      channelUniqueName: channel.uniqueName,
      discussionId: dc.discussionId
    } END) WHERE entry IS NOT NULL] AS feedbackDiscussionChannels
  }
  CALL {
    WITH feedbackEvent
    OPTIONAL MATCH (feedbackEvent)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN ec IS NULL THEN null ELSE {
      id: ec.id,
      channelUniqueName: channel.uniqueName,
      eventId: ec.eventId
    } END) WHERE entry IS NOT NULL] AS feedbackEventChannels
  }
  CALL {
    WITH feedbackOnComment
    OPTIONAL MATCH (feedbackOnComment)<-[:CONTAINS_COMMENT]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN head([entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      discussionId: dc.discussionId,
      channelUniqueName: channel.uniqueName
    } END) WHERE entry IS NOT NULL]) AS feedbackCommentDiscussionChannel
  }
  CALL {
    WITH feedbackOnComment
    OPTIONAL MATCH (event:Event)-[:HAS_COMMENT]->(feedbackOnComment)
    OPTIONAL MATCH (event)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    WITH event, [entry IN collect(DISTINCT CASE WHEN ec IS NULL THEN null ELSE {
      id: ec.id,
      channelUniqueName: channel.uniqueName,
      eventId: ec.eventId
    } END) WHERE entry IS NOT NULL] AS eventChannels
    RETURN head(collect(CASE WHEN event IS NULL THEN null ELSE {
      id: event.id,
      title: coalesce(event.title, ''),
      createdAt: toString(event.createdAt),
      EventChannels: eventChannels
    } END)) AS feedbackCommentEvent
  }

  WITH feedbackComment, feedbackDiscussion, feedbackEvent, feedbackOnComment,
       feedbackDiscussionChannels, feedbackEventChannels,
       feedbackCommentDiscussionChannel, feedbackCommentEvent
  RETURN [entry IN collect(
    CASE WHEN NOT $mayAccessSensitiveContent AND (
      coalesce(feedbackDiscussion.hasSensitiveContent, false) = true
      OR EXISTS { MATCH (feedbackOnComment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(feedbackCommentDiscussion:Discussion) WHERE coalesce(feedbackCommentDiscussion.hasSensitiveContent, false) = true }
    ) THEN null ELSE {
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
        text: coalesce(feedbackComment.text, ''),
        createdAt: toString(feedbackComment.createdAt)
      },
      Issue: null,
      RelatedDiscussion: CASE WHEN feedbackDiscussion IS NULL THEN null ELSE {
        id: feedbackDiscussion.id,
        title: coalesce(feedbackDiscussion.title, ''),
        createdAt: toString(feedbackDiscussion.createdAt),
        DiscussionChannels: feedbackDiscussionChannels
      } END,
      RelatedEvent: CASE WHEN feedbackEvent IS NULL THEN null ELSE {
        id: feedbackEvent.id,
        title: coalesce(feedbackEvent.title, ''),
        createdAt: toString(feedbackEvent.createdAt),
        EventChannels: feedbackEventChannels
      } END,
      RelatedComment: CASE WHEN feedbackOnComment IS NULL THEN null ELSE {
        id: feedbackOnComment.id,
        text: coalesce(feedbackOnComment.text, ''),
        createdAt: toString(feedbackOnComment.createdAt),
        DiscussionChannel: feedbackCommentDiscussionChannel,
        Event: feedbackCommentEvent
      } END
    } END
  ) WHERE entry IS NOT NULL] AS feedbackActivities
}

WITH actionActivities + feedbackActivities AS allActivities
UNWIND allActivities AS activity
WITH date(datetime(activity.createdAt)) AS activityDate, collect(activity) AS activities
RETURN
  toString(activityDate) AS date,
  size(activities) AS count,
  activities
ORDER BY activityDate ASC
