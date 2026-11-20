MATCH (d:Discussion {id: $discussionId}), (c:Channel {uniqueName: $channelUniqueName}), (u:User {username: $upvotedBy})
OPTIONAL MATCH (dc:DiscussionChannel {discussionId: $discussionId, channelUniqueName: $channelUniqueName})
OPTIONAL MATCH (c)-[:HAS_DISCUSSION_FLAIR]->(selectedFlair:DiscussionFlair)
WHERE selectedFlair.id IN $flairIds
  AND coalesce(selectedFlair.archived, false) = false
WITH d, c, u, dc, collect(selectedFlair) AS selectedFlairs
WHERE dc IS NULL  // Skip creation if it already exists
// Allocate the next per-forum discussion number so discussions get short,
// human-friendly URLs (/forums/cats/discussions/42-trail-conditions). Mirrors
// the ChannelIssueCounter pattern: self-heal from the current max so the
// counter survives manual inserts and backfills. Runs only inside the create
// branch above, so an idempotent re-run does not consume a number.
MERGE (counter:ChannelDiscussionCounter {channelUniqueName: $channelUniqueName})
  ON CREATE SET counter.current = 0
WITH d, c, u, selectedFlairs, counter
CALL {
    WITH counter
    OPTIONAL MATCH (existingDc:DiscussionChannel {channelUniqueName: counter.channelUniqueName})
    RETURN coalesce(max(existingDc.discussionNumber), 0) AS maxExisting
}
SET counter.current = (CASE WHEN counter.current < maxExisting THEN maxExisting ELSE counter.current END) + 1
WITH d, c, u, selectedFlairs, counter.current AS discussionNumber
CREATE (newDc:DiscussionChannel {
    discussionId: $discussionId,
    channelUniqueName: $channelUniqueName,
    discussionNumber: discussionNumber,
    id: apoc.create.uuid(),
    createdAt: datetime(),
    // Lets the age-gate reconcile step find this node in the writing
    // transaction (services/ageGate/reconcile.ts).
    ageGateTouchedAt: datetime(),
    archived: false
})
MERGE (newDc)-[:POSTED_IN_CHANNEL]->(d)
MERGE (newDc)-[:POSTED_IN_CHANNEL]->(c)
FOREACH (selectedFlair IN selectedFlairs |
    MERGE (newDc)-[:HAS_DISCUSSION_FLAIR]->(selectedFlair)
)
MERGE (u)-[:UPVOTED_DISCUSSION]->(newDc)
// Only subscribe to notifications if user has opted in
FOREACH (ignoreMe IN CASE WHEN u.notifyOnReplyToDiscussionByDefault = true THEN [1] ELSE [] END |
    MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(newDc)
) 
WITH newDc, d, c, u, selectedFlairs
WITH newDc, d, c, selectedFlairs, collect(u {username: u.username}) as upvotedByUsers
RETURN {
    id: newDc.id,
    discussionId: newDc.discussionId,
    channelUniqueName: newDc.channelUniqueName,
    discussionNumber: newDc.discussionNumber,
    createdAt: newDc.createdAt,
    Discussion: d {.*},
    Channel: c {.*},
    Flairs: [selectedFlair IN selectedFlairs | selectedFlair {.*}],
    UpvotedByUsers: upvotedByUsers
} as discussionChannel
