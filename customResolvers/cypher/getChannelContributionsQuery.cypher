// Query to find all contributors (discussions + comments) to a channel
MATCH (channel:Channel {uniqueName: $channelUniqueName})

// Find all users who have contributed
WITH channel
CALL {
  WITH channel
  // Find discussion authors
  MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
  MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
  MATCH (u:User)-[:POSTED_DISCUSSION]->(d)
  WHERE date(datetime(d.createdAt)) >= date($startDate)
    AND date(datetime(d.createdAt)) <= date($endDate)
  RETURN u, d.createdAt AS createdAt, 'discussion' AS type, d AS item, dc

  UNION

  WITH channel
  // Find comment authors
  MATCH (u:User)-[:AUTHORED_COMMENT]->(c:Comment)
  MATCH (c)<-[:CONTAINS_COMMENT]-(commentDc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
  WHERE date(datetime(c.createdAt)) >= date($startDate)
    AND date(datetime(c.createdAt)) <= date($endDate)
  RETURN u, c.createdAt AS createdAt, 'comment' AS type, c AS item, commentDc AS dc
}

WITH u, type, item, dc, createdAt
ORDER BY createdAt DESC

// Collect activities per user
WITH u,
  collect({
    type: type,
    createdAt: toString(createdAt),
    discussion: CASE WHEN type = 'discussion'
      THEN {
        id: item.id,
        title: item.title,
        createdAt: toString(item.createdAt),
        Author: {
          username: u.username,
          profilePicURL: u.profilePicURL
        },
        DiscussionChannels: [{
          id: dc.id,
          channelUniqueName: dc.channelUniqueName,
          discussionId: dc.discussionId
        }]
      }
      ELSE null
    END,
    comment: CASE WHEN type = 'comment'
      THEN {
        id: item.id,
        text: item.text,
        createdAt: toString(item.createdAt),
        CommentAuthor: {
          username: u.username,
          profilePicURL: u.profilePicURL
        },
        Channel: null,
        DiscussionChannel: {
          id: dc.id,
          discussionId: dc.discussionId,
          channelUniqueName: dc.channelUniqueName
        }
      }
      ELSE null
    END
  }) AS allActivities

// Group by date
UNWIND allActivities AS activity
WITH u,
  date(datetime(activity.createdAt)) AS activityDate,
  activity

WITH u, activityDate,
  collect(activity.discussion) AS discussionsOnDate,
  collect(activity.comment) AS commentsOnDate

// Filter out nulls
WITH u, activityDate,
  [d IN discussionsOnDate WHERE d IS NOT NULL] AS discussions,
  [c IN commentsOnDate WHERE c IS NOT NULL] AS comments

// Build day data
WITH u,
  collect({
    date: toString(activityDate),
    count: size(discussions) + size(comments),
    activities: [{
      id: 'activity-' + toString(activityDate),
      type: 'activity',
      description: 'Activity on ' + toString(activityDate),
      Comments: comments,
      Discussions: discussions
    }]
  }) AS dayData

// Return results
RETURN
  u.username AS username,
  u.displayName AS displayName,
  u.profilePicURL AS profilePicURL,
  reduce(total = 0, d IN dayData | total + d.count) AS totalContributions,
  dayData
ORDER BY totalContributions DESC
LIMIT toInteger(COALESCE($limit, 10))
