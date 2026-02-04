import { updateDiscussionChannelQuery, severConnectionBetweenDiscussionAndChannelQuery } from "../cypher/cypherQueries.js";
import { discussionVersionHistoryHandler } from "../../hooks/discussionVersionHistoryHook.js";
import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateNode, sanitizeAlbumUpdateNode } from "./utils/ownershipSanitizers.js";
const getResolver = (input) => {
    const { Discussion, driver } = input;
    return async (parent, args, context, info) => {
        var _a, _b, _c, _d;
        const { where, discussionUpdateInput, channelConnections = [], channelDisconnections = [] } = args;
        let sanitizedUpdateInput = discussionUpdateInput;
        const albumInput = discussionUpdateInput === null || discussionUpdateInput === void 0 ? void 0 : discussionUpdateInput.Album;
        const albumCreateNode = (_a = albumInput === null || albumInput === void 0 ? void 0 : albumInput.create) === null || _a === void 0 ? void 0 : _a.node;
        const albumUpdateNode = (_b = albumInput === null || albumInput === void 0 ? void 0 : albumInput.update) === null || _b === void 0 ? void 0 : _b.node;
        const albumUpdateImagesCreate = Array.isArray(albumUpdateNode === null || albumUpdateNode === void 0 ? void 0 : albumUpdateNode.Images)
            ? (_c = albumUpdateNode === null || albumUpdateNode === void 0 ? void 0 : albumUpdateNode.Images) === null || _c === void 0 ? void 0 : _c.some((image) => { var _a; return (_a = image === null || image === void 0 ? void 0 : image.create) === null || _a === void 0 ? void 0 : _a.length; })
            : false;
        const needsAlbumSanitization = Boolean(albumCreateNode) || Boolean(albumUpdateNode) || Boolean(albumUpdateImagesCreate);
        if (needsAlbumSanitization) {
            context.user = await setUserDataOnContext({
                context,
                getPermissionInfo: false,
            });
            const username = (_d = context.user) === null || _d === void 0 ? void 0 : _d.username;
            if (!username) {
                throw new GraphQLError("You must be logged in to update albums.");
            }
            if (albumInput) {
                const nextAlbumInput = { ...albumInput };
                if (albumCreateNode) {
                    nextAlbumInput.create = {
                        ...albumInput.create,
                        node: sanitizeAlbumCreateNode(albumCreateNode, username),
                    };
                }
                if (albumUpdateNode) {
                    nextAlbumInput.update = {
                        ...albumInput.update,
                        node: sanitizeAlbumUpdateNode(albumUpdateNode, username),
                    };
                }
                sanitizedUpdateInput = {
                    ...discussionUpdateInput,
                    Album: nextAlbumInput,
                };
            }
        }
        try {
            // Track version history before updating the discussion
            if (sanitizedUpdateInput.title || sanitizedUpdateInput.body) {
                await discussionVersionHistoryHandler({
                    context,
                    params: {
                        where,
                        update: sanitizedUpdateInput
                    }
                });
            }
            // Update the discussion
            await Discussion.update({
                where: where,
                update: sanitizedUpdateInput,
            });
            const updatedDiscussionId = where.id;
            const session = driver.session();
            // Update the channel connections
            for (let i = 0; i < channelConnections.length; i++) {
                const channelUniqueName = channelConnections[i];
                // For each channel connection, create a DiscussionChannel node
                // if one does not already exist.
                // Join the DiscussionChannel to the Discussion and Channel nodes.
                // If there was an existing one, join that. If we just created one,
                // join that.
                await session.run(updateDiscussionChannelQuery, {
                    discussionId: updatedDiscussionId,
                    channelUniqueName: channelUniqueName,
                });
            }
            // Update the channel disconnections
            for (let i = 0; i < channelDisconnections.length; i++) {
                const channelUniqueName = channelDisconnections[i];
                // For each channel disconnection, sever the connection between
                // the Discussion and the DiscussionChannel node.
                // We intentionally do not delete the DiscussionChannel node
                // because it contains comments that are authored by other users
                // than the discussion author, and the discussion author should
                // not have permission to delete those comments.
                await session.run(severConnectionBetweenDiscussionAndChannelQuery, {
                    discussionId: updatedDiscussionId,
                    channelUniqueName: channelUniqueName,
                });
            }
            // Refetch the newly created discussion with the channel connections
            // and disconnections so that we can return it.
            const selectionSet = `
        {
          id
          title
          body
          Author {
            username
          }
          DiscussionChannels {
            id
            channelUniqueName
            discussionId
            Channel {
              uniqueName
            }
            Discussion {
              id
            }
          }
          createdAt
          updatedAt
          Tags {
            text
          }
          PastTitleVersions {
            id
            body
            createdAt
            Author {
              username
            }
          }
          PastBodyVersions {
            id
            body
            createdAt
            Author {
              username
            }
          }
        }
      `;
            const result = await Discussion.find({
                where: {
                    id: updatedDiscussionId,
                },
                selectionSet,
            });
            session.close();
            return result[0];
        }
        catch (error) {
            console.error("Error updating discussion:", error);
            throw new Error(`Failed to update discussion. ${error.message}`);
        }
    };
};
export default getResolver;
