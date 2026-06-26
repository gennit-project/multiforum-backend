MATCH (dc:DiscussionChannel { id: $discussionChannelId })-[:CONTAINS_COMMENT]->(c:Comment)
WHERE c.isRootComment = true
AND NOT EXISTS((c)-[:HAS_FEEDBACK_COMMENT]->(:Discussion)) 

OPTIONAL MATCH (c)<-[:AUTHORED_COMMENT]-(author:User)
OPTIONAL MATCH (author)-[:HAS_SERVER_ROLE]->(serverRole:ServerRole)
OPTIONAL MATCH (author)-[:HAS_CHANNEL_ROLE]->(channelRole:ChannelRole)
OPTIONAL MATCH (c)-[:IS_REPLY_TO]->(parent:Comment)
OPTIONAL MATCH (c)<-[:IS_REPLY_TO]-(child:Comment)
OPTIONAL MATCH (c)<-[:UPVOTED_COMMENT]-(upvoter:User)
OPTIONAL MATCH (c)<-[:SUPER_UPVOTED_COMMENT]-(superUpvoter:User)
OPTIONAL MATCH (c)-[:HAS_VERSION]->(pastVersion:TextVersion)<-[:AUTHORED_VERSION]-(pastVersionAuthor:User)
OPTIONAL MATCH (favUser:User { username: $loggedInUsername })-[:DEFAULT_FAVORITES_COMMENTS]->(c)

WITH c, author, serverRole, channelRole, parent, child, upvoter, superUpvoter, $modName AS modName, pastVersion, pastVersionAuthor, favUser

OPTIONAL MATCH (c)<-[:HAS_FEEDBACK_COMMENT]-(feedbackComment:Comment)<-[:AUTHORED_COMMENT]-(feedbackAuthor:ModerationProfile)

WITH c, author, serverRole, channelRole, parent, child, upvoter, superUpvoter, modName, feedbackComment, feedbackAuthor, pastVersion, pastVersionAuthor, favUser,
     CASE WHEN modName IS NOT NULL AND feedbackAuthor.displayName = modName THEN feedbackComment
          ELSE NULL END AS filteredFeedbackComment

WITH c, author, serverRole, channelRole, parent,
     COLLECT(DISTINCT upvoter{.*, createdAt: toString(upvoter.createdAt)}) AS UpvotedByUsers,
     COLLECT(DISTINCT superUpvoter{.*, createdAt: toString(superUpvoter.createdAt)}) AS SuperUpvotedByUsers,
     COLLECT(DISTINCT parent.id) AS parentIds,
     COLLECT(DISTINCT filteredFeedbackComment {id: feedbackComment.id}) AS FeedbackComments,
     COLLECT(DISTINCT CASE WHEN child IS NOT NULL THEN {id: child.id, text: child.text} ELSE null END) AS NonFilteredChildComments,
     COLLECT(DISTINCT CASE WHEN pastVersion IS NOT NULL THEN {
       id: pastVersion.id,
       body: pastVersion.body,
       createdAt: pastVersion.createdAt,
       Author: CASE WHEN pastVersionAuthor IS NOT NULL THEN {
         username: pastVersionAuthor.username
       } ELSE null END
     } ELSE null END) AS PastVersions,
     COUNT(DISTINCT favUser) > 0 AS isFavoritedByUser

WITH c, author, serverRole, channelRole, parent, UpvotedByUsers, SuperUpvotedByUsers, parentIds, isFavoritedByUser,
    [comment IN NonFilteredChildComments WHERE comment.id IS NOT NULL] AS ChildComments,
    [version IN PastVersions WHERE version.id IS NOT NULL] AS FilteredPastVersions,
    FeedbackComments

// Author ADMIN/MOD badges are now membership-derived (the authorIsChannelModerator
// @cypher field + server-admin membership), so the author's roles are no longer
// projected onto the comment. Collapse the serverRole/channelRole fan-out.
WITH DISTINCT c, author, parent, UpvotedByUsers, SuperUpvotedByUsers, parentIds, isFavoritedByUser,
    ChildComments, FilteredPastVersions, FeedbackComments

RETURN {
    id: c.id,
    text: c.text,
    emoji: c.emoji,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    archived: c.archived,
    CommentAuthor: CASE WHEN author IS NULL THEN null ELSE {
        username: author.username,
        displayName: author.displayName,
        profilePicURL: author.profilePicURL,
        discussionKarma: author.discussionKarma,
        commentKarma: author.commentKarma,
        createdAt: author.createdAt
    } END,
    isFavoritedByUser: isFavoritedByUser,
    ParentComment: CASE WHEN SIZE(parentIds) > 0 THEN {id: parentIds[0]} ELSE null END,
    UpvotedByUsers: UpvotedByUsers,
    UpvotedByUsersAggregate: {
        count: SIZE(UpvotedByUsers)
    },
    SuperUpvotedByUsers: SuperUpvotedByUsers,
    ChildComments: CASE WHEN SIZE(ChildComments) > 0 THEN ChildComments ELSE [] END,
    ChildCommentsAggregate: {
        count: SIZE(ChildComments)
    },
    FeedbackComments: FeedbackComments,
    PastVersions: FilteredPastVersions
} AS comment

ORDER BY c.createdAt DESC
SKIP toInteger($offset)
LIMIT toInteger($limit)
