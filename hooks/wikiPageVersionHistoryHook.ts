import type { TextVersionCreateInput } from "../src/generated/graphql.js";
import type { GraphQLContext } from "../types/context.js";
import type {
  WikiPageModel,
  WikiPageUpdateInput,
  TextVersionModel,
  UserModel,
} from "../ogm_types.js";

type WikiPageVersionHistoryHandlerInput = {
  context: GraphQLContext;
  params: {
    where?: { id?: string | null };
    update?: { title?: string | null; body?: string | null } | null;
  };
};

/**
 * Hook to track wikiPage version history when a wikiPage is updated
 * This will capture the old title and body before the update is applied
 */
export const wikiPageVersionHistoryHandler = async ({ context, params }: WikiPageVersionHistoryHandlerInput) => {
  try {
    console.log('WikiPage version history hook running...');
    
    // Extract parameters from the update operation
    const { where, update } = params;
    const wikiPageId = where?.id;
    
    // Make sure we have a wikiPage ID and update data
    if (!wikiPageId || !update) {
      console.log('Missing wikiPage ID or update data');
      return;
    }
    
    // Check if title or body is being updated
    const isTitleUpdated = update.title !== undefined;
    const isBodyUpdated = update.body !== undefined;
    
    // If neither title nor body is being updated, skip version tracking
    if (!isTitleUpdated && !isBodyUpdated) {
      console.log('No title or body updates detected, skipping version history');
      return;
    }
    
    console.log('Processing version history for wikiPage:', wikiPageId);
    
    // Access OGM models
    const { ogm } = context;
    const WikiPageModel = ogm.model('WikiPage');
    const TextVersionModel = ogm.model('TextVersion');
    const UserModel = ogm.model('User');
    
    // Fetch the current wikiPage to get current values before update
    const wikiPages = await WikiPageModel.find({
      where: { id: wikiPageId },
      selectionSet: `{
        id
        title
        body
        editReason
        VersionAuthor {
          username
        }
        PastVersions {
          id
          body
          createdAt
        }
      }`
    });

    if (!wikiPages.length) {
      console.log('WikiPage not found');
      return;
    }

    const wikiPage = wikiPages[0];
    const username = wikiPage.VersionAuthor?.username;
    
    if (!username) {
      console.log('Author username not found');
      return;
    }
    
    // Track version history if title is being updated
    if (isTitleUpdated && update.title !== wikiPage.title) {
      await trackVersionHistory(
        wikiPageId,
        wikiPage.title,
        wikiPage.editReason,
        username,
        WikiPageModel,
        TextVersionModel,
        UserModel
      );
    }
    
    // Track version history if body is being updated
    if (isBodyUpdated && update.body !== wikiPage.body && wikiPage.body) {
      await trackVersionHistory(
        wikiPageId,
        wikiPage.body,
        wikiPage.editReason,
        username,
        WikiPageModel,
        TextVersionModel,
        UserModel
      );
    }
  } catch (error) {
    console.error('Error in wikiPage version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

/**
 * Track version history for a wikiPage
 */
async function trackVersionHistory(
  wikiPageId: string,
  previousContent: string,
  editReason: string | null | undefined,
  username: string,
  WikiPageModel: WikiPageModel,
  TextVersionModel: TextVersionModel,
  UserModel: UserModel
) {
  console.log(`Tracking version history for wikiPage ${wikiPageId}`);

  try {
    // Skip tracking if previous content is null or empty
    if (!previousContent) {
      console.log('Previous content is empty, skipping version history');
      return;
    }

    // Get user by username
    const users = await UserModel.find({
      where: { username },
      selectionSet: `{ username }`
    });

    if (!users.length) {
      console.log('User not found');
      return;
    }

    // Create new TextVersion for previous content
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionInput: TextVersionCreateInput = {
      body: previousContent,
      Author: {
        connect: { where: { node: { username } } }
      }
    };

    if (editReason) {
      textVersionInput.editReason = editReason;
    }

    const textVersionResult = await TextVersionModel.create({
      input: [textVersionInput]
    });

    if (!textVersionResult.textVersions.length) {
      console.log('Failed to create TextVersion');
      return;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current wikiPage
    const wikiPages = await WikiPageModel.find({
      where: { id: wikiPageId },
      selectionSet: `{
        id
      }`
    });

    if (!wikiPages.length) {
      console.log('WikiPage not found when updating version history');
      return;
    }

    // Update wikiPage to connect the new TextVersion
    await WikiPageModel.update({
      where: { id: wikiPageId },
      update: {
        PastVersions: {
          connect: [{
            where: {
              node: { id: textVersionId }
            }
          }]
        }
      } as unknown as WikiPageUpdateInput
    });

    console.log(`Successfully added version history for wikiPage ${wikiPageId}`);
  } catch (error) {
    console.error('Error tracking version history:', error);
  }
}
