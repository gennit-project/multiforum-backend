MATCH (parentComment:Comment { id: $commentId })<-[:IS_REPLY_TO]-(child:Comment)

// OPTIONAL MATCHES to get related details
OPTIONAL MATCH (child)<-[:AUTHORED_COMMENT]-(author:User)
OPTIONAL MATCH (author)-[:HAS_SERVER_ROLE]->(serverRole:ServerRole)
OPTIONAL MATCH (author)-[:HAS_CHANNEL_ROLE]->(channelRole:ChannelRole)
OPTIONAL MATCH (child)<-[:UPVOTED_COMMENT]-(upvoter:User)
OPTIONAL MATCH (child)-[:HAS_VERSION]->(pastVersion:TextVersion)<-[:AUTHORED_VERSION]-(pastVersionAuthor:User)
OPTIONAL MATCH (favUser:User { username: $loggedInUsername })-[:DEFAULT_FAVORITES_COMMENTS]->(child)

// Collect details for each child comment
WITH parentComment, child, author,
     COLLECT(DISTINCT serverRole) AS serverRoles,
     COLLECT(DISTINCT channelRole) AS channelRoles,
     COLLECT(DISTINCT upvoter) AS UpvotedByUsers,
     COUNT(DISTINCT favUser) > 0 AS isFavoritedByUser,
     COLLECT(DISTINCT CASE WHEN pastVersion IS NOT NULL THEN {
       id: pastVersion.id,
       body: pastVersion.body,
       createdAt: pastVersion.createdAt,
       Author: CASE WHEN pastVersionAuthor IS NOT NULL THEN {
         username: pastVersionAuthor.username
       } ELSE null END
     } ELSE null END) AS PastVersions

// Get the count of grandchild comments separately
OPTIONAL MATCH (child)<-[:IS_REPLY_TO]-(grandchild:Comment)
WITH parentComment, child, author, serverRoles, channelRoles, UpvotedByUsers, PastVersions, isFavoritedByUser,
     COUNT(DISTINCT grandchild) AS GrandchildCommentsCount

// Match feedback comments
OPTIONAL MATCH (child)<-[:HAS_FEEDBACK_COMMENT]-(feedbackComment:Comment)<-[:AUTHORED_COMMENT]-(feedbackAuthor:ModerationProfile)
WITH parentComment, child, author, serverRoles, channelRoles, UpvotedByUsers, PastVersions, GrandchildCommentsCount, isFavoritedByUser,
     COLLECT(DISTINCT CASE WHEN feedbackComment IS NOT NULL THEN {id: feedbackComment.id} END) AS FeedbackComments,
     COLLECT(DISTINCT feedbackAuthor) AS FeedbackAuthors

// Filter for specific moderator feedback
WITH parentComment, child, author, serverRoles, channelRoles, UpvotedByUsers, 
     [version IN PastVersions WHERE version.id IS NOT NULL] AS FilteredPastVersions, 
     GrandchildCommentsCount, FeedbackComments, FeedbackAuthors, isFavoritedByUser,
     CASE WHEN $modName IS NOT NULL THEN [comment IN FeedbackComments WHERE ANY(author IN FeedbackAuthors WHERE author.displayName = $modName)] ELSE [] END AS FilteredFeedbackComments

// Calculations for the sorting formulae
WITH parentComment, child, author, serverRoles, channelRoles, GrandchildCommentsCount, FilteredFeedbackComments, isFavoritedByUser,
     UpvotedByUsers, FilteredPastVersions,
     duration.between(child.createdAt, datetime()).months + 
     duration.between(child.createdAt, datetime()).days / 30.0 AS ageInMonths,
     CASE WHEN coalesce(child.weightedVotesCount, 0) < 0 THEN 0 ELSE coalesce(child.weightedVotesCount, 0) END AS weightedVotesCount

WITH parentComment, child, author, serverRoles, channelRoles, UpvotedByUsers, ageInMonths, weightedVotesCount,
     GrandchildCommentsCount, FilteredFeedbackComments, FilteredPastVersions, isFavoritedByUser,
     10000 * log10(weightedVotesCount + 1) / ((ageInMonths + 2) ^ 1.8) AS hotRank

WITH parentComment, child, author, UpvotedByUsers, weightedVotesCount, hotRank, GrandchildCommentsCount, FilteredFeedbackComments, FilteredPastVersions, isFavoritedByUser,
     serverRoles, channelRoles

WITH parentComment, child, author, UpvotedByUsers, weightedVotesCount, hotRank, GrandchildCommentsCount, FilteredFeedbackComments, FilteredPastVersions, isFavoritedByUser,
     [role IN serverRoles | {showAdminTag: role.showAdminTag}] AS serverRoles, channelRoles

WITH parentComment, child, author, UpvotedByUsers, weightedVotesCount, hotRank, GrandchildCommentsCount, FilteredFeedbackComments, FilteredPastVersions, serverRoles, isFavoritedByUser,
     [role IN channelRoles | {showModTag: role.showModTag}] AS channelRoles

// Structure the return data
RETURN {
    id: child.id,
    text: child.text,
    emoji: child.emoji,
    weightedVotesCount: child.weightedVotesCount,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
    archived: child.archived,
    ParentComment: {
        id: parentComment.id
    },
    CommentAuthor: {
        username: author.username,
        displayName: author.displayName,
        profilePicURL: author.profilePicURL,
        discussionKarma: author.discussionKarma,
        commentKarma: author.commentKarma,
        createdAt: author.createdAt,
        ServerRoles: serverRoles,
        ChannelRoles: channelRoles
    },
    isFavoritedByUser: isFavoritedByUser,
    UpvotedByUsers: [user IN UpvotedByUsers | user{.*, createdAt: toString(user.createdAt)}],
    UpvotedByUsersAggregate: {
        count: SIZE(UpvotedByUsers)
    },
    ChildCommentsAggregate: {
        count: GrandchildCommentsCount
    },
    // Return empty array if no feedback comment
    FeedbackComments: [comment IN FilteredFeedbackComments WHERE comment IS NOT NULL | comment],
    PastVersions: FilteredPastVersions
} AS ChildComments, weightedVotesCount, hotRank

ORDER BY 
    CASE WHEN $sortOption = "top" THEN weightedVotesCount END DESC,
    CASE WHEN $sortOption = "hot" THEN hotRank END DESC,
    child.createdAt DESC

SKIP toInteger($offset)
LIMIT toInteger($limit)
