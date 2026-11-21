MATCH (e:Event {id: $eventId}), (c:Channel {uniqueName: $channelUniqueName})
MERGE (ec:EventChannel {eventId: $eventId, channelUniqueName: $channelUniqueName})
ON CREATE SET ec.id = apoc.create.uuid(), ec.createdAt = datetime()
// Allocate a per-forum event number (short URL id) if this EventChannel lacks
// one — newly created by the MERGE above, or legacy pre-numbering data. Unit
// subquery (no RETURN), so it never multiplies or drops the outer row.
WITH e, ec, c
CALL {
    WITH ec
    WITH ec WHERE ec.eventNumber IS NULL
    MERGE (counter:ChannelEventCounter {channelUniqueName: ec.channelUniqueName})
      ON CREATE SET counter.current = 0
    WITH ec, counter
    OPTIONAL MATCH (existingEc:EventChannel {channelUniqueName: counter.channelUniqueName})
    WITH ec, counter, coalesce(max(existingEc.eventNumber), 0) AS maxExisting
    SET counter.current = (CASE WHEN counter.current < maxExisting THEN maxExisting ELSE counter.current END) + 1
    SET ec.eventNumber = counter.current
}
WITH e, ec, c
MERGE (ec)-[:POSTED_IN_CHANNEL]->(c)
WITH e, ec, c
MERGE (ec)-[:POSTED_IN_CHANNEL]->(e)
RETURN ec, e, c