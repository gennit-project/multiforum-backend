MATCH (dc:DiscussionChannel { id: $discussionChannelId })-[:CONTAINS_COMMENT]->(c:Comment)
WHERE c.isRootComment = true
AND NOT EXISTS((c)-[:HAS_FEEDBACK_COMMENT]->(:Discussion)) 

OPTIONAL MATCH (c)<-[:AUTHORED_COMMENT]-(author:User)
OPTIONAL MATCH (author)-[:HAS_SERVER_ROLE]->(serverRole:ServerRole)
OPTIONAL MATCH (author)-[:HAS_CHANNEL_ROLE]->(channelRole:ChannelRole)
OPTIONAL MATCH (c)-[:IS_REPLY_TO]->(parent:Comment)
OPTIONAL MATCH (c)<-[:IS_REPLY_TO]-(child:Comment)
OPTIONAL MATCH (c)<-[:UPVOTED_COMMENT]-(upvoter:User)
OPTIONAL MATCH (c)-[:HAS_VERSION]->(pastVersion:TextVersion)<-[:AUTHORED_VERSION]-(pastVersionAuthor:User)

WITH c, author, serverRole, channelRole, parent, child, upvoter, $modName AS modName, pastVersion, pastVersionAuthor

OPTIONAL MATCH (c)<-[:HAS_FEEDBACK_COMMENT]-(feedbackComment:Comment)<-[:AUTHORED_COMMENT]-(feedbackAuthor:ModerationProfile)

WITH c, author, serverRole, channelRole, parent, child, upvoter, modName, feedbackComment, feedbackAuthor, pastVersion, pastVersionAuthor,
     CASE WHEN modName IS NOT NULL AND feedbackAuthor.displayName = modName THEN feedbackComment
          ELSE NULL END AS filteredFeedbackComment

WITH c, author, serverRole, channelRole, parent,
     COLLECT(DISTINCT upvoter{.*, createdAt: toString(upvoter.createdAt)}) AS UpvotedByUsers, 
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
     } ELSE null END) AS PastVersions

WITH c, author, serverRole, channelRole, parent, UpvotedByUsers, parentIds,
    [comment IN NonFilteredChildComments WHERE comment.id IS NOT NULL] AS ChildComments,
    [version IN PastVersions WHERE version.id IS NOT NULL] AS FilteredPastVersions,
    FeedbackComments

WITH c, author, channelRole, parent, UpvotedByUsers, parentIds, 
    ChildComments, FilteredPastVersions, FeedbackComments,
    COLLECT(DISTINCT serverRole) AS serverRoles

WITH c, author, channelRole, parent, UpvotedByUsers, parentIds,
    ChildComments, FilteredPastVersions, FeedbackComments,
    [role IN serverRoles | {showAdminTag: role.showAdminTag}] as serverRoles

WITH c, author, parent, UpvotedByUsers, parentIds,
    ChildComments, FilteredPastVersions, FeedbackComments, serverRoles,
    COLLECT(DISTINCT channelRole) AS channelRoles

WITH c, author, parent, UpvotedByUsers, parentIds,
    ChildComments, FilteredPastVersions, FeedbackComments, serverRoles,
    [role IN channelRoles | {showModTag: role.showModTag}] as channelRoles

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
        createdAt: author.createdAt,
        ServerRoles: serverRoles,
        ChannelRoles: channelRoles
    } END,
    ParentComment: CASE WHEN SIZE(parentIds) > 0 THEN {id: parentIds[0]} ELSE null END,
    UpvotedByUsers: UpvotedByUsers,
    UpvotedByUsersAggregate: {
        count: SIZE(UpvotedByUsers)
    },
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