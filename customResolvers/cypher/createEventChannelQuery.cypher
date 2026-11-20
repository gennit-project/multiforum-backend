MATCH (e:Event {id: $eventId}), (c:Channel {uniqueName: $channelUniqueName}), (u:User {username: $poster})
OPTIONAL MATCH (ec:EventChannel {eventId: $eventId, channelUniqueName: $channelUniqueName})
WITH e, c, u, ec
WHERE ec IS NULL  // Skip creation if it already exists
// Allocate the next per-forum event number so events get short, human-friendly
// URLs (/forums/cats/events/7-saturday-cleanup). Mirrors the ChannelIssueCounter
// pattern: self-heal from the current max so the counter survives manual
// inserts and backfills. Runs only in the create branch above.
MERGE (counter:ChannelEventCounter {channelUniqueName: $channelUniqueName})
  ON CREATE SET counter.current = 0
WITH e, c, u, counter
CALL {
    WITH counter
    OPTIONAL MATCH (existingEc:EventChannel {channelUniqueName: counter.channelUniqueName})
    RETURN coalesce(max(existingEc.eventNumber), 0) AS maxExisting
}
SET counter.current = (CASE WHEN counter.current < maxExisting THEN maxExisting ELSE counter.current END) + 1
WITH e, c, u, counter.current AS eventNumber
CREATE (newEc:EventChannel {
    eventId: $eventId,
    channelUniqueName: $channelUniqueName,
    eventNumber: eventNumber,
    id: apoc.create.uuid(),
    createdAt: datetime(),
    archived: false
})
MERGE (newEc)-[:POSTED_IN_CHANNEL]->(e)
MERGE (newEc)-[:POSTED_IN_CHANNEL]->(c)
// Only subscribe to notifications if user has opted in
FOREACH (ignoreMe IN CASE WHEN u.notifyOnReplyToEventByDefault = true THEN [1] ELSE [] END |
    MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e)
) 
RETURN {
    id: newEc.id,
    eventId: newEc.eventId,
    channelUniqueName: newEc.channelUniqueName,
    eventNumber: newEc.eventNumber,
    createdAt: newEc.createdAt,
    archived: newEc.archived,
    Event: e {.*},
    Channel: c {.*}
} as eventChannel