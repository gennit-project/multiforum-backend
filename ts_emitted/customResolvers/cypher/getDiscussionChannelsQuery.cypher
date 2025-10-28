// First, calculate the total count of discussion channels matching the criteria
MATCH (dc:DiscussionChannel {channelUniqueName: $channelUniqueName})
WHERE 
    EXISTS((dc)-[:POSTED_IN_CHANNEL]->(:Discussion))
    AND ($searchInput = "" OR EXISTS { 
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion) 
        WHERE d.title =~ $titleRegex OR d.body =~ $bodyRegex
    })
    AND (CASE WHEN $sortOption = "top" THEN (datetime(dc.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis OR $startOfTimeFrame IS NULL ) ELSE TRUE END)
    AND (
        SIZE($selectedTags) = 0 OR 
        EXISTS { 
            MATCH (dc)-[:POSTED_IN_CHANNEL]->(d)-[:HAS_TAG]->(tag:Tag) 
            WHERE tag.text IN $selectedTags 
        }
    )
   // If archived=false, exclude archived. If archived=true, include archived.
    AND ($showArchived OR coalesce(dc.archived, false) = false)
    // Filter by hasDownload if specified
    AND ($hasDownload IS NULL OR EXISTS { 
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion) 
        WHERE ($hasDownload = true AND d.hasDownload = true) OR ($hasDownload = false AND (d.hasDownload = false OR d.hasDownload IS NULL))
    })
    // Filter by label options if specified
    AND (
        SIZE($labelFilters) = 0 OR 
        ALL(labelFilter IN $labelFilters WHERE 
            EXISTS {
                MATCH (dc)-[:HAS_LABEL_OPTION]->(fo:FilterOption)-[:HAS_FILTER_OPTION]-(fg:FilterGroup)
                WHERE fg.key = labelFilter.groupKey AND fo.value IN labelFilter.values
            }
        )
    )
    

WITH COUNT(dc) AS totalCount

// Now, fetch the discussion channels with pagination and other filters
MATCH (dc:DiscussionChannel {channelUniqueName: $channelUniqueName})
WHERE 
    ($searchInput = "" OR EXISTS { 
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion) 
        WHERE d.title =~ $titleRegex OR d.body =~ $bodyRegex
    })
    AND (CASE WHEN $sortOption = "top" THEN (datetime(dc.createdAt).epochMillis > datetime($startOfTimeFrame).epochMillis OR $startOfTimeFrame IS NULL ) ELSE TRUE END)
    AND (
        SIZE($selectedTags) = 0 OR 
        EXISTS { 
            MATCH (dc)-[:POSTED_IN_CHANNEL]->(d)-[:HAS_TAG]->(tag:Tag) 
            WHERE tag.text IN $selectedTags 
        }
    )
    // If archived=false, exclude archived. If archived=true, include archived.
    AND ($showArchived OR coalesce(dc.archived, false) = false)
    // Filter by hasDownload if specified
    AND ($hasDownload IS NULL OR EXISTS { 
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion) 
        WHERE ($hasDownload = true AND d.hasDownload = true) OR ($hasDownload = false AND (d.hasDownload = false OR d.hasDownload IS NULL))
    })
    // Filter by label options if specified
    AND (
        SIZE($labelFilters) = 0 OR 
        ALL(labelFilter IN $labelFilters WHERE 
            EXISTS {
                MATCH (dc)-[:HAS_LABEL_OPTION]->(fo:FilterOption)-[:HAS_FILTER_OPTION]-(fg:FilterGroup)
                WHERE fg.key = labelFilter.groupKey AND fo.value IN labelFilter.values
            }
        )
    )

WITH dc, totalCount
MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
OPTIONAL MATCH (d)-[:HAS_TAG]->(tag:Tag)
WITH dc, d, COLLECT(DISTINCT tag.text) AS tagsText, totalCount

OPTIONAL MATCH (d)<-[:POSTED_DISCUSSION]-(author:User)
OPTIONAL MATCH (author)-[:HAS_SERVER_ROLE]->(serverRole:ServerRole)
OPTIONAL MATCH (author)-[:HAS_CHANNEL_ROLE]->(channelRole:ChannelRole)

// Modified upvoter collection to only get count and logged-in user if they upvoted
OPTIONAL MATCH (upvoter:User)-[:UPVOTED_DISCUSSION]->(dc)
WITH dc, d, author, serverRole, channelRole, tagsText, 
     COLLECT(DISTINCT upvoter) AS allUpvoters,
     COUNT(DISTINCT upvoter) AS totalUpvoters,
     COALESCE($loggedInUsername, "") AS loggedInUsername,
     totalCount

// Filter for logged-in user's upvote
OPTIONAL MATCH (loggedInUser:User {username: loggedInUsername})-[:UPVOTED_DISCUSSION]->(dc)
WITH dc, d, author, serverRole, channelRole, tagsText, 
     CASE 
         WHEN loggedInUsername = "" THEN []
         WHEN loggedInUser IS NOT NULL THEN [{username: loggedInUser.username}]
         ELSE []
     END AS loggedInUserUpvote,
     totalUpvoters,
     totalCount,
     CASE WHEN coalesce(dc.weightedVotesCount, 0.0) < 0 THEN 0.0 ELSE coalesce(dc.weightedVotesCount, 0.0) END AS weightedVotesCount

OPTIONAL MATCH (dc)-[:CONTAINS_COMMENT]->(c:Comment)
WITH dc, d, author, serverRole, channelRole, COLLECT(c) AS comments, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, totalCount,
     duration.between(dc.createdAt, datetime()).months + 
     duration.between(dc.createdAt, datetime()).days / 30.0 AS ageInMonths

WITH dc, d, author, serverRole, channelRole, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, comments, totalCount,
     10000 * log10(weightedVotesCount + 1) / ((ageInMonths + 2) ^ 1.8) AS hotRank

WITH dc, d, author, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, comments, hotRank, totalCount,
     COLLECT(DISTINCT serverRole) AS serverRoles, channelRole

WITH dc, d, author, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, comments, hotRank, serverRoles, channelRole, totalCount

WITH dc, d, author, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, comments, hotRank, totalCount,
     [role in serverRoles | {showAdminTag: role.showAdminTag}] AS serverRoles, 
     [role in COLLECT(DISTINCT channelRole) | {showModTag: role.showModTag}] AS channelRoles

// Sort based on individual elements, not the collection
ORDER BY 
    CASE WHEN $sortOption = "new" THEN dc.createdAt END DESC,
    CASE WHEN $sortOption = "top" THEN weightedVotesCount END DESC,
    CASE WHEN $sortOption = "hot" THEN hotRank END DESC,
    dc.createdAt DESC

// Apply pagination
WITH totalCount, dc, d, author, tagsText, loggedInUserUpvote, totalUpvoters, weightedVotesCount, comments, hotRank, serverRoles, channelRoles
SKIP toInteger($offset)
LIMIT toInteger($limit)

OPTIONAL MATCH (d)-[:HAS_ALBUM]->(album:Album)
OPTIONAL MATCH (album)-[:HAS_IMAGE]->(image:Image)
WHERE image.id IS NOT NULL

WITH totalCount, dc, d, author, tagsText, loggedInUserUpvote, totalUpvoters,
     weightedVotesCount, comments, hotRank, serverRoles, channelRoles,
     album,
     COLLECT(DISTINCT CASE WHEN image IS NOT NULL THEN {
         id: image.id,
         url: image.url,
         alt: image.alt,
         caption: image.caption
     } END) AS albumImages

// Return the results with modified UpvotedByUsers
RETURN {
    id: dc.id,
    archived: dc.archived,
    answered: dc.answered,
    locked: dc.locked,
    discussionId: d.id,
    createdAt: dc.createdAt,
    channelUniqueName: dc.channelUniqueName,
    weightedVotesCount: weightedVotesCount,
    CommentsAggregate: {
        count: SIZE(comments)
    },
    UpvotedByUsers: [up in loggedInUserUpvote | { username: up.username }],
    UpvotedByUsersAggregate: {
        count: totalUpvoters 
    },
    Discussion: {
        id: d.id,
        title: d.title,
        body: d.body,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        hasSensitiveContent: d.hasSensitiveContent,
        hasSpoiler: d.hasSpoiler,
        Author: CASE
                  WHEN author IS NULL THEN null
                  ELSE {
                      username: author.username,
                      displayName: author.displayName,
                      profilePicURL: author.profilePicURL,
                      createdAt: author.createdAt,
                      discussionKarma: author.discussionKarma,
                      commentKarma: author.commentKarma,
                      ServerRoles: serverRoles,
                      ChannelRoles: channelRoles
                  }
                END,
        Album: CASE 
                WHEN album IS NULL THEN null 
                ELSE {
                    id: album.id,
                    imageOrder: album.imageOrder,
                    Images: albumImages
                }
              END,
        Tags: [t IN tagsText | {text: t}]
    },
    Channel: {
        uniqueName: dc.channelUniqueName
    }
} AS DiscussionChannel, totalCount
