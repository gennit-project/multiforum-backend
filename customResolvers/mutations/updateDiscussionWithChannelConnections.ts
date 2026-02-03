import { updateDiscussionChannelQuery, severConnectionBetweenDiscussionAndChannelQuery } from "../cypher/cypherQueries.js";
import { DiscussionWhere, DiscussionUpdateInput } from "../../src/generated/graphql";
import { discussionVersionHistoryHandler } from "../../hooks/discussionVersionHistoryHook.js";
import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateNode, sanitizeAlbumUpdateNode } from "./utils/ownershipSanitizers.js";

type Input = {
  Discussion: any;
  driver: any;
};

type Args = {
  where: DiscussionWhere;
  discussionUpdateInput: DiscussionUpdateInput;
  channelConnections?: string[];
  channelDisconnections?: string[];
};

const getResolver = (input: Input) => {
  const { Discussion, driver } = input;
  return async (parent: any, args: Args, context: any, info: any) => {
    const {
      where,
      discussionUpdateInput,
      channelConnections = [],
      channelDisconnections = []
    } = args;

    let sanitizedUpdateInput = discussionUpdateInput;
    const albumInput = discussionUpdateInput?.Album;
    const albumCreateNode = albumInput?.create?.node;
    const albumUpdateNode = albumInput?.update?.node;
    const albumUpdateImagesCreate = Array.isArray(albumUpdateNode?.Images)
      ? albumUpdateNode?.Images?.some((image) => image?.create?.length)
      : false;

    const needsAlbumSanitization =
      Boolean(albumCreateNode) || Boolean(albumUpdateNode) || Boolean(albumUpdateImagesCreate);

    if (needsAlbumSanitization) {
      context.user = await setUserDataOnContext({
        context,
        getPermissionInfo: false,
      });

      const username = context.user?.username;

      if (!username) {
        throw new GraphQLError("You must be logged in to update albums.");
      }

      if (albumInput) {
        const nextAlbumInput: any = { ...albumInput };

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
    } catch (error: any) {
      console.error("Error updating discussion:", error);
      throw new Error(`Failed to update discussion. ${error.message}`);
    }
  };
};
export default getResolver;
