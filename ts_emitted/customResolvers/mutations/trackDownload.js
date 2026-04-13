import { GraphQLError } from 'graphql';
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js';
const toNumber = (value) => {
    var _a;
    if (typeof value === 'number') {
        return value;
    }
    return (_a = value === null || value === void 0 ? void 0 : value.toNumber()) !== null && _a !== void 0 ? _a : 0;
};
const getCurrentUser = async (input) => {
    var _a;
    const { context, getUserData } = input;
    if ((_a = context.user) === null || _a === void 0 ? void 0 : _a.username) {
        return context.user;
    }
    context.user = await getUserData({
        context,
        getPermissionInfo: false
    });
    return context.user;
};
const trackDownload = ({ driver, getUserData = setUserDataOnContext }) => {
    return async (_parent, args, context) => {
        var _a, _b;
        const { downloadableFileId, discussionId } = args;
        if (!downloadableFileId) {
            throw new GraphQLError('Downloadable file ID is required');
        }
        if (!discussionId) {
            throw new GraphQLError('Discussion ID is required');
        }
        const currentUser = await getCurrentUser({ context, getUserData });
        const username = (currentUser === null || currentUser === void 0 ? void 0 : currentUser.username) || null;
        const session = driver.session({ defaultAccessMode: 'WRITE' });
        try {
            if (!username) {
                const result = await session.run(`
          MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
          SET file.downloadCountTotal = coalesce(file.downloadCountTotal, 0) + 1
          RETURN count(file) AS updated
          `, {
                    downloadableFileId,
                    discussionId
                });
                const updated = toNumber((_a = result.records[0]) === null || _a === void 0 ? void 0 : _a.get('updated'));
                if (updated < 1) {
                    throw new GraphQLError('Downloadable file not found for this discussion');
                }
                return true;
            }
            const result = await session.run(`
        MATCH (user:User {username: $username})
        MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
        OPTIONAL MATCH (user)-[existingDownload:DOWNLOADED_FILE]->(file)
        WITH user, discussion, file, existingDownload IS NULL AS isUnique
        MERGE (user)-[download:DOWNLOADED_FILE]->(file)
          ON CREATE SET download.createdAt = datetime()
        SET
          download.lastDownloadedAt = datetime(),
          file.downloadCountTotal = coalesce(file.downloadCountTotal, 0) + 1,
          file.downloadCountUnique = coalesce(file.downloadCountUnique, 0) + CASE WHEN isUnique THEN 1 ELSE 0 END
        MERGE (user)-[:OWNS_DOWNLOAD]->(discussion)
        RETURN count(file) AS updated
        `, {
                username,
                downloadableFileId,
                discussionId
            });
            const updated = toNumber((_b = result.records[0]) === null || _b === void 0 ? void 0 : _b.get('updated'));
            if (updated < 1) {
                throw new GraphQLError('Downloadable file not found for this discussion');
            }
            return true;
        }
        finally {
            session.close();
        }
    };
};
export default trackDownload;
