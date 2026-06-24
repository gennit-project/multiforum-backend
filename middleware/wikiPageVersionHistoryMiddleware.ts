/**
 * Middleware for tracking wikiPage version history
 * This middleware runs before wikiPage update operations to capture the previous
 * values of title and body before they are updated.
 */

// Import the handler function that contains the version history logic
import { wikiPageVersionHistoryHandler } from "../hooks/wikiPageVersionHistoryHook.js";
import { GraphQLResolveInfo } from 'graphql';
import type { TextVersionCreateInput } from "../src/generated/graphql.js";
import type { GraphQLContext } from "../types/context.js";
import type {
  TextVersionModel,
  WikiPageModel,
  WikiPageUpdateInput,
} from "../ogm_types.js";

// Define types for the middleware
interface UpdateWikiPagesArgs {
  where?: {
    id?: string;
  };
  update?: {
    title?: string;
    body?: string;
    editReason?: string;
    ChildPages?: { create?: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Define the middleware
const wikiPageVersionHistoryMiddleware = {
  Mutation: {
    // Apply to the auto-generated updateWikiPages mutation
    updateWikiPages: async (
      resolve: (parent: unknown, args: UpdateWikiPagesArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown,
      args: UpdateWikiPagesArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      // Extract the parameters that we need for version history tracking
      const { where, update } = args;
      if (!update) {
        return resolve(parent, args, context, info);
      }
      
      // Check if this is creating new child WikiPages
      const isCreatingChildPages = update.ChildPages?.create;
      
      if (isCreatingChildPages) {
        // Handle child WikiPage creation - create first TextVersions after creation
        const result = await resolve(parent, args, context, info);
        await handleChildWikiPageCreation(
          result as UpdateWikiPagesResult | undefined,
          update,
          context
        );
        return result;
      } else if (update.title || update.body) {
        // Run the version history handler before the update (existing functionality)
        await wikiPageVersionHistoryHandler({ 
          context, 
          params: { where, update } 
        });
      }
      
      // Continue with the standard resolver
      return resolve(parent, args, context, info);
    }
  }
};

/**
 * Handle creation of child WikiPages by creating first TextVersions
 */
interface ChildWikiPage {
  id: string;
  title?: string | null;
  body?: string | null;
  editReason?: string | null;
}

interface UpdateWikiPagesResult {
  updateWikiPages?: {
    wikiPages?: Array<{
      ChildPages?: ChildWikiPage[];
    }>;
  };
}

async function handleChildWikiPageCreation(
  result: UpdateWikiPagesResult | undefined,
  update: Record<string, unknown>,
  context: GraphQLContext
) {
  try {
    const { ogm } = context;
    const TextVersionModel = ogm.model('TextVersion');
    const WikiPageModel = ogm.model('WikiPage');
    
    // Get the updated WikiPages from the result
    const wikiPages = result?.updateWikiPages?.wikiPages;
    if (!wikiPages || !wikiPages.length) {
      console.log('No wikiPages found in result for child page creation');
      return;
    }
    
    // Get the current user from context - placeholder for now
    const currentUsername = getCurrentUsernameFromContext(context);
    
    if (!currentUsername) {
      console.log('Could not determine current user for child WikiPage creation');
      return;
    }
    
    // Process each parent WikiPage that might have new child pages
    for (const parentWikiPage of wikiPages) {
      const childPages = parentWikiPage.ChildPages;
      if (!childPages || !childPages.length) {
        continue;
      }
      
      // Create TextVersions for each new child page
      for (const childPage of childPages) {
        console.log(`Creating first TextVersion for child WikiPage ${childPage.id}`);
        
        if (childPage.title) {
          await createFirstTextVersion(
            TextVersionModel,
            childPage.id,
            childPage.title,
            childPage.editReason,
            currentUsername,
            WikiPageModel
          );
        }
        
        if (childPage.body) {
          await createFirstTextVersion(
            TextVersionModel,
            childPage.id,
            childPage.body,
            childPage.editReason,
            currentUsername,
            WikiPageModel
          );
        }
      }
    }
    
    console.log('Successfully created first TextVersions for child WikiPages');
  } catch (error) {
    console.error('Error creating first TextVersions for child pages:', error);
    // Don't throw the error - we don't want to break the WikiPage creation
  }
}

/**
 * Create a TextVersion and connect it to a WikiPage
 */
async function createFirstTextVersion(
  TextVersionModel: TextVersionModel,
  wikiPageId: string,
  content: string,
  editReason: string | null | undefined,
  username: string,
  WikiPageModel: WikiPageModel
) {
  try {
    const textVersionInput: TextVersionCreateInput = {
      body: content,
      Author: {
        connect: { where: { node: { username } } }
      }
    };

    if (editReason) {
      textVersionInput.editReason = editReason;
    }

    // Create the TextVersion
    const textVersionResult = await TextVersionModel.create({
      input: [textVersionInput]
    });

    if (!textVersionResult.textVersions.length) {
      console.log('Failed to create TextVersion');
      return;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Connect the TextVersion to the WikiPage
    await WikiPageModel.update({
      where: { id: wikiPageId },
      // The OGM-generated WikiPageUpdateInput expects PastVersions as an array of
      // update-field inputs; this connect-shaped payload is the runtime shape the
      // OGM accepts, so cast to satisfy the generated type without changing behavior.
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

    console.log(`Successfully created first TextVersion for WikiPage ${wikiPageId}`);
  } catch (error) {
    console.error(`Error creating first TextVersion for WikiPage ${wikiPageId}:`, error);
  }
}

/**
 * Get the current username from the request context
 * This is a placeholder - implement according to your auth system
 */
function getCurrentUsernameFromContext(context: GraphQLContext): string | null {
  // TODO: Implement proper user extraction from context
  // This might involve decoding JWT tokens from headers, session management, etc.
  // For now, return a placeholder
  return 'system'; // Replace with actual user extraction logic
}

export default wikiPageVersionHistoryMiddleware;
