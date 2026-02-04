import { getCommentRepliesQuery } from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
const getResolver = (input) => {
    const { driver, Comment } = input;
    return async (parent, args, context, info) => {
        var _a;
        const { commentId, modName, offset, limit, sort } = args;
        context.user = await setUserDataOnContext({
            context,
            getPermissionInfo: false,
        });
        const loggedInUsername = ((_a = context.user) === null || _a === void 0 ? void 0 : _a.username) || null;
        const session = driver.session();
        try {
            let commentsResult = [];
            let aggregateCount = 0;
            const commentRepliesResult = await session.run(getCommentRepliesQuery, {
                commentId,
                modName,
                offset: parseInt(offset, 10),
                limit: parseInt(limit, 10),
                sortOption: sort === "top" ? "top" : sort === "hot" ? "hot" : "new",
                loggedInUsername,
            });
            if (commentRepliesResult.records.length === 0) {
                return {
                    ChildComments: [],
                    aggregateChildCommentCount: 0,
                };
            }
            commentsResult = commentRepliesResult.records.map((record) => {
                return record.get("ChildComments");
            });
            aggregateCount = await Comment.aggregate({
                where: {
                    ParentComment: {
                        id: commentId,
                    },
                },
                aggregate: {
                    count: true,
                },
            }).then((result) => {
                return result.count;
            });
            return {
                ChildComments: commentsResult,
                aggregateChildCommentCount: aggregateCount || 0,
            };
        }
        catch (error) {
            console.error("Error getting comment section:", error);
            throw new Error(`Failed to fetch comment section. ${error.message}`);
        }
        finally {
            session.close();
        }
    };
};
export default getResolver;
