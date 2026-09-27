MATCH (u:User {username: $username})
WITH u, date($startDate) AS startDate, date($endDate) AS endDate

// Keep each activity type in a scoped subquery. This avoids carrying the rows
// from one-to-many relationships into the next activity match.
CALL {
  WITH u, startDate, endDate
  MATCH (u)-[:AUTHORED_COMMENT]->(comment:Comment)
  WHERE date(datetime(comment.createdAt)) >= startDate
    AND date(datetime(comment.createdAt)) <= endDate
    AND ($mayAccessSensitiveContent OR (
      NOT EXISTS { MATCH (comment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(sensitiveDiscussion:Discussion) WHERE coalesce(sensitiveDiscussion.hasSensitiveContent, false) = true }
      AND NOT EXISTS { MATCH (comment)-[:HAS_FEEDBACK_COMMENT]->(sensitiveDiscussion:Discussion) WHERE coalesce(sensitiveDiscussion.hasSensitiveContent, false) = true }
      AND NOT EXISTS { MATCH (comment)-[:HAS_FEEDBACK_COMMENT]->(:Comment)-[:IS_REPLY_TO*0..]->(:Comment)<-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(sensitiveDiscussion:Discussion) WHERE coalesce(sensitiveDiscussion.hasSensitiveContent, false) = true }
    ))

  CALL {
    WITH comment
    OPTIONAL MATCH (comment)<-[:CONTAINS_COMMENT]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN head([entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      discussionId: dc.discussionId,
      channelUniqueName: channel.uniqueName
    } END) WHERE entry IS NOT NULL]) AS discussionChannel
  }
  CALL {
    WITH comment
    OPTIONAL MATCH (event:Event)-[:HAS_COMMENT]->(comment)
    RETURN head(collect(DISTINCT event)) AS event
  }

  RETURN collect({
    id: comment.id,
    text: coalesce(comment.text, ''),
    createdAt: toString(comment.createdAt),
    CommentAuthor: {
      username: u.username,
      profilePicURL: u.profilePicURL
    },
    Channel: null,
    DiscussionChannel: discussionChannel,
    Event: CASE WHEN event IS NULL THEN null ELSE {
      id: event.id,
      title: coalesce(event.title, ''),
      createdAt: toString(event.createdAt)
    } END
  }) AS comments
}

CALL {
  WITH u, startDate, endDate
  MATCH (u)-[:POSTED_DISCUSSION]->(discussion:Discussion)
  WHERE date(datetime(discussion.createdAt)) >= startDate
    AND date(datetime(discussion.createdAt)) <= endDate
    AND ($mayAccessSensitiveContent OR coalesce(discussion.hasSensitiveContent, false) = false)

  CALL {
    WITH discussion
    OPTIONAL MATCH (discussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN dc IS NULL THEN null ELSE {
      id: dc.id,
      channelUniqueName: channel.uniqueName,
      discussionId: dc.discussionId
    } END) WHERE entry IS NOT NULL] AS discussionChannels
  }

  RETURN collect({
    id: discussion.id,
    title: coalesce(discussion.title, ''),
    createdAt: toString(discussion.createdAt),
    hasDownload: discussion.hasDownload,
    Author: {
      username: u.username,
      profilePicURL: u.profilePicURL
    },
    DiscussionChannels: discussionChannels
  }) AS discussions
}

CALL {
  WITH u, startDate, endDate
  MATCH (u)-[:POSTED_BY]->(event:Event)
  WHERE date(datetime(event.createdAt)) >= startDate
    AND date(datetime(event.createdAt)) <= endDate

  CALL {
    WITH event
    OPTIONAL MATCH (event)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [entry IN collect(DISTINCT CASE WHEN ec IS NULL THEN null ELSE {
      id: ec.id,
      channelUniqueName: channel.uniqueName,
      eventId: ec.eventId
    } END) WHERE entry IS NOT NULL] AS eventChannels
  }

  RETURN collect({
    id: event.id,
    title: coalesce(event.title, ''),
    createdAt: toString(event.createdAt),
    Poster: {
      username: u.username,
      profilePicURL: u.profilePicURL
    },
    EventChannels: eventChannels
  }) AS events
}

CALL {
  WITH u, startDate, endDate
  MATCH (u)-[:AUTHORED_VERSION]->(wikiEdit:TextVersion)
  WHERE date(datetime(wikiEdit.createdAt)) >= startDate
    AND date(datetime(wikiEdit.createdAt)) <= endDate
  OPTIONAL MATCH (wikiPage:WikiPage)-[:HAS_VERSION]->(wikiEdit)
  RETURN collect({
    id: wikiEdit.id,
    body: coalesce(wikiEdit.body, ''),
    editReason: wikiEdit.editReason,
    createdAt: toString(wikiEdit.createdAt),
    Author: {
      username: u.username,
      profilePicURL: u.profilePicURL
    },
    WikiPage: CASE WHEN wikiPage IS NULL THEN null ELSE {
      id: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      channelUniqueName: wikiPage.channelUniqueName
    } END
  }) AS wikiEdits
}

WITH comments + discussions + events + wikiEdits AS allActivities
UNWIND allActivities AS activity
WITH date(datetime(activity.createdAt)) AS activityDate, collect(activity) AS activities
RETURN
  toString(activityDate) AS date,
  size(activities) AS count,
  [{
    id: 'activity-' + toString(activityDate),
    type: 'activity',
    description: 'Activity on ' + toString(activityDate),
    Comments: [a IN activities WHERE a.text IS NOT NULL | a],
    Discussions: [a IN activities WHERE a.title IS NOT NULL AND a.DiscussionChannels IS NOT NULL AND (a.hasDownload = false OR a.hasDownload IS NULL) | a],
    Downloads: [a IN activities WHERE a.title IS NOT NULL AND a.DiscussionChannels IS NOT NULL AND a.hasDownload = true | a],
    Events: [a IN activities WHERE a.title IS NOT NULL AND a.EventChannels IS NOT NULL | a],
    WikiEdits: [a IN activities WHERE a.WikiPage IS NOT NULL | a]
  }] AS activities
ORDER BY activityDate ASC
