MATCH (d:Discussion {id: $discussionId}), (c:Channel {uniqueName: $channelUniqueName}), (u:User {username: $upvotedBy})
OPTIONAL MATCH (dc:DiscussionChannel {discussionId: $discussionId, channelUniqueName: $channelUniqueName})
OPTIONAL MATCH (c)-[:HAS_DISCUSSION_FLAIR]->(selectedFlair:DiscussionFlair)
WHERE selectedFlair.id IN $flairIds
  AND coalesce(selectedFlair.archived, false) = false
WITH d, c, u, dc, collect(selectedFlair) AS selectedFlairs
WHERE dc IS NULL  // Skip creation if it already exists
CREATE (newDc:DiscussionChannel {
    discussionId: $discussionId, 
    channelUniqueName: $channelUniqueName, 
    id: apoc.create.uuid(), 
    createdAt: datetime(),
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
    createdAt: newDc.createdAt,
    Discussion: d {.*},
    Channel: c {.*},
    Flairs: [selectedFlair IN selectedFlairs | selectedFlair {.*}],
    UpvotedByUsers: upvotedByUsers
} as discussionChannel
