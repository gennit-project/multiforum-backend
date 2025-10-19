MATCH (u:User {username: $username})
WITH u, date($startDate) AS startDate, date($endDate) AS endDate

// Match comments and related data
OPTIONAL MATCH (u)-[:AUTHORED_COMMENT]->(comment:Comment)
WHERE date(datetime(comment.createdAt)) >= startDate AND date(datetime(comment.createdAt)) <= endDate
OPTIONAL MATCH (comment)<-[:AUTHORED_COMMENT]-(commentAuthor:User)

// Match DiscussionChannel and its Channel (for permalink info)
OPTIONAL MATCH (comment)<-[:CONTAINS_COMMENT]-(discussionChannel:DiscussionChannel)
OPTIONAL MATCH (discussionChannel)-[:POSTED_IN_CHANNEL]->(discussionChannelNode:Channel)

// Match Event that contains this comment
OPTIONAL MATCH (event:Event)-[:HAS_COMMENT]->(comment)

WITH u, startDate, endDate, collect({
  id: comment.id,
  text: COALESCE(comment.text, ""),
  createdAt: toString(comment.createdAt),
  CommentAuthor: CASE WHEN commentAuthor IS NOT NULL THEN { 
    username: commentAuthor.username,
    profilePicURL: COALESCE(commentAuthor.profilePicURL, null)
  } ELSE NULL END,
  Channel: null,
  DiscussionChannel: CASE 
    WHEN discussionChannel IS NOT NULL THEN { 
      id: discussionChannel.id, 
      discussionId: discussionChannel.discussionId,
      channelUniqueName: discussionChannelNode.uniqueName 
    } ELSE NULL END,
  Event: CASE WHEN event IS NOT NULL THEN { 
    id: event.id,
    title: COALESCE(event.title, ""),
    createdAt: toString(event.createdAt)
  } ELSE NULL END
}) AS comments

// Match discussions
OPTIONAL MATCH (u)-[:POSTED_DISCUSSION]->(discussion:Discussion)
WHERE date(datetime(discussion.createdAt)) >= startDate AND date(datetime(discussion.createdAt)) <= endDate
OPTIONAL MATCH (discussion)<-[:POSTED_DISCUSSION]-(discussionAuthor:User)
OPTIONAL MATCH (discussion)<-[:POSTED_IN_CHANNEL]-(discussionChannel:DiscussionChannel)
OPTIONAL MATCH (discussionChannel)-[:POSTED_IN_CHANNEL]->(discussionChannelNode:Channel)
WITH u, startDate, endDate, comments, collect({
  id: discussion.id,
  title: COALESCE(discussion.title, ""),
  createdAt: toString(discussion.createdAt),
  hasDownload: discussion.hasDownload,
  Author: CASE WHEN discussionAuthor IS NOT NULL THEN {
    username: discussionAuthor.username,
    profilePicURL: COALESCE(discussionAuthor.profilePicURL, null)
  } ELSE NULL END,
  DiscussionChannels: CASE WHEN discussionChannel IS NOT NULL THEN [{
    id: discussionChannel.id,
    channelUniqueName: discussionChannelNode.uniqueName,
    discussionId: discussionChannel.discussionId
  }] ELSE [] END
}) AS discussions

// Match events and related event channels
OPTIONAL MATCH (u)-[:POSTED_BY]->(event:Event)
WHERE date(datetime(event.createdAt)) >= startDate AND date(datetime(event.createdAt)) <= endDate
OPTIONAL MATCH (event)<-[:POSTED_BY]-(eventPoster:User)
OPTIONAL MATCH (event)<-[:POSTED_IN_CHANNEL]-(eventChannel:EventChannel)
OPTIONAL MATCH (eventChannel)-[:POSTED_IN_CHANNEL]->(eventChannelNode:Channel)
WITH comments, discussions, collect({
  id: event.id,
  title: COALESCE(event.title, ""),
  createdAt: toString(event.createdAt),
  Poster: CASE WHEN eventPoster IS NOT NULL THEN {
    username: eventPoster.username,
    profilePicURL: COALESCE(eventPoster.profilePicURL, null)
  } ELSE NULL END,
  EventChannels: CASE WHEN eventChannel IS NOT NULL THEN [{
    id: eventChannel.id,
    channelUniqueName: eventChannelNode.uniqueName,
    eventId: eventChannel.eventId
  }] ELSE [] END
}) AS events

// Combine and group
WITH (comments + discussions + events) AS allActivities
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
    Events: [a IN activities WHERE a.title IS NOT NULL AND a.EventChannels IS NOT NULL | a]
  }] AS activities
ORDER BY activityDate ASC