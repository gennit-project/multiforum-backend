MATCH (event:Event {id: $eventId})
OPTIONAL MATCH (poster:User)-[:POSTED_BY]->(event)

CALL {
  WITH event
  OPTIONAL MATCH (event)-[:HAS_TAG]->(tag:Tag)
  RETURN [text IN collect(DISTINCT tag.text) WHERE text IS NOT NULL | {text: text}] AS tags
}

CALL {
  WITH event
  OPTIONAL MATCH (entry:EventChannel)-[:POSTED_IN_CHANNEL]->(event)
  OPTIONAL MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel)
  RETURN [value IN collect(CASE WHEN entry IS NULL THEN null ELSE entry {
    .id, .eventId, .channelUniqueName,
    Channel: CASE WHEN channel IS NULL THEN null ELSE channel {
      .uniqueName, .displayName, .channelIconURL
    } END
  } END) WHERE value IS NOT NULL] AS eventChannels
}

CALL {
  WITH event
  OPTIONAL MATCH (viewer:User {username: $loggedInUsername})-[:SUBSCRIBED_TO_NOTIFICATIONS]->(event)
  RETURN CASE WHEN viewer IS NULL THEN [] ELSE [{username: viewer.username}] END AS viewerNotificationSubscription
}

CALL {
  WITH event
  OPTIONAL MATCH (viewer:User {username: $loggedInUsername})-[:SUBSCRIBED_TO_EVENT_UPDATES]->(event)
  RETURN CASE WHEN viewer IS NULL THEN [] ELSE [{username: viewer.username}] END AS viewerUpdateSubscription
}

RETURN event {
  .id, .title, .description, .startTime, .endTime, .locationName, .address,
  .virtualEventUrl, .startTimeDayOfWeek, .startTimeHourOfDay, .canceled,
  .isHostedByOP, .isAllDay, .coverImageURL, .createdAt, .updatedAt,
  .isInPrivateResidence, .location, .cost,
  Tags: tags,
  EventChannels: eventChannels,
  SubscribedToNotifications: viewerNotificationSubscription,
  SubscribedToEventUpdates: viewerUpdateSubscription,
  Poster: CASE WHEN poster IS NULL THEN null ELSE poster {
    .username, .createdAt, .discussionKarma, .commentKarma
  } END
} AS Event
