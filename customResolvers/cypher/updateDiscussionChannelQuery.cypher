// - If a DiscussionChannel for the combination of discussionId and channelUniqueName
//   doesn't exist, it'll be created and linked to both Discussion and Channel.
// - If a DiscussionChannel for the combination of discussionId and channelUniqueName
//   does exist and the connection to the Discussion was severed earlier, it'll
//   re-establish that connection.
// - If a DiscussionChannel for the combination of discussionId and channelUniqueName
//   does exist and is already properly connected to the Discussion, the query will
//   have no effect on that particular connection.
MATCH (d:Discussion {id: $discussionId}), (c:Channel {uniqueName: $channelUniqueName})
MERGE (dc:DiscussionChannel {discussionId: $discussionId, channelUniqueName: $channelUniqueName})
ON CREATE SET dc.id = apoc.create.uuid(), dc.createdAt = datetime()
// Allocate a per-forum discussion number (short URL id) if this DiscussionChannel
// lacks one — newly created by the MERGE above (e.g. adding a crosspost via an
// edit), or legacy pre-numbering data. Unit subquery (no RETURN), so it never
// multiplies or drops the outer row.
WITH d, dc, c
CALL {
    WITH dc
    WITH dc WHERE dc.discussionNumber IS NULL
    MERGE (counter:ChannelDiscussionCounter {channelUniqueName: dc.channelUniqueName})
      ON CREATE SET counter.current = 0
    WITH dc, counter
    OPTIONAL MATCH (existingDc:DiscussionChannel {channelUniqueName: counter.channelUniqueName})
    WITH dc, counter, coalesce(max(existingDc.discussionNumber), 0) AS maxExisting
    SET counter.current = (CASE WHEN counter.current < maxExisting THEN maxExisting ELSE counter.current END) + 1
    SET dc.discussionNumber = counter.current
}
WITH d, dc, c
MERGE (dc)-[:POSTED_IN_CHANNEL]->(c)
WITH d, dc, c
OPTIONAL MATCH (dc)-[oldFlairRelationship:HAS_DISCUSSION_FLAIR]->(:DiscussionFlair)
WITH d, dc, c, collect(oldFlairRelationship) AS oldFlairRelationships
FOREACH (oldFlairRelationship IN CASE
  WHEN $flairSelectionProvided THEN oldFlairRelationships
  ELSE []
END | DELETE oldFlairRelationship)
WITH d, dc, c
OPTIONAL MATCH (c)-[:HAS_DISCUSSION_FLAIR]->(selectedFlair:DiscussionFlair)
WHERE selectedFlair.id IN $flairIds
  AND coalesce(selectedFlair.archived, false) = false
WITH d, dc, c, collect(selectedFlair) AS selectedFlairs
FOREACH (selectedFlair IN selectedFlairs |
  MERGE (dc)-[:HAS_DISCUSSION_FLAIR]->(selectedFlair)
)
MERGE (dc)-[:POSTED_IN_CHANNEL]->(d)
// New or reconnected to its discussion: stamp it so the age-gate reconcile
// step re-evaluates it in this transaction (services/ageGate/reconcile.ts).
SET dc.ageGateTouchedAt = datetime()
RETURN dc, d, c, selectedFlairs
