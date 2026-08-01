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
RETURN dc, d, c, selectedFlairs
