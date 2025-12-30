
import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from './issueActivityFeedHelpers.js';

/**
 * Hook to track discussion version history when a discussion is updated
 * This will capture the old title and body before the update is applied
 */
export const discussionVersionHistoryHandler = async ({ context, params }: any) => {
  try {
    console.log('Discussion version history hook running...');
    
    // Extract parameters from the update operation
    const { where, update } = params;
    const discussionId = where?.id;
    
    // Make sure we have a discussion ID and update data
    if (!discussionId || !update) {
      console.log('Missing discussion ID or update data');
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
    
    console.log('Processing version history for discussion:', discussionId);
    
    // Access OGM models
    const { ogm } = context;
    const DiscussionModel = ogm.model('Discussion');
    const TextVersionModel = ogm.model('TextVersion');
    const UserModel = ogm.model('User');
    const IssueModel = ogm.model('Issue');
    
    // Fetch the current discussion to get current values before update
    const discussions = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: `{
        id
        title
        body
        Author {
          username
        }
        PastTitleVersions {
          id
          body
          createdAt
        }
        PastBodyVersions {
          id
          body
          createdAt
        }
      }`
    });

    if (!discussions.length) {
      console.log('Discussion not found');
      return;
    }

    const discussion = discussions[0];
    const username = context?.user?.username || discussion.Author?.username;
    
    if (!username) {
      console.log('Author username not found');
      return;
    }
    
    const createdRevisionIds: Array<{ id: string; type: 'title' | 'body' }> = [];

    // Track title version history if title is being updated
    if (isTitleUpdated && update.title !== discussion.title) {
      const titleRevisionId = await trackTitleVersionHistory(
        discussionId,
        discussion.title,
        username,
        DiscussionModel,
        TextVersionModel,
        UserModel
      );
      if (titleRevisionId) {
        createdRevisionIds.push({ id: titleRevisionId, type: 'title' });
      }
    }
    
    // Track body version history if body is being updated
    if (isBodyUpdated && update.body !== discussion.body) {
      const bodyRevisionId = await trackBodyVersionHistory(
        discussionId,
        discussion.body,
        username,
        DiscussionModel,
        TextVersionModel,
        UserModel
      );
      if (bodyRevisionId) {
        createdRevisionIds.push({ id: bodyRevisionId, type: 'body' });
      }
    }

    if (!createdRevisionIds.length) {
      return;
    }

    const issueIds = await getIssueIdsForRelated(IssueModel, {
      discussionId,
    });
    if (!issueIds.length) {
      return;
    }

    const attribution = getAttributionFromContext(context);
    for (const revision of createdRevisionIds) {
      await createIssueActivityFeedItems({
        IssueModel,
        issueIds,
        actionDescription:
          revision.type === 'title'
            ? 'edited the discussion title'
            : 'edited the discussion body',
        actionType: 'edit',
        attribution,
        revisionId: revision.id,
      });
    }
  } catch (error) {
    console.error('Error in discussion version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

/**
 * Track title version history for a discussion
 */
async function trackTitleVersionHistory(
  discussionId: string,
  previousTitle: string,
  username: string,
  DiscussionModel: any,
  TextVersionModel: any,
  UserModel: any
): Promise<string | null> {
  console.log(`Tracking title version history for discussion ${discussionId}`);
  console.log(`Previous title: "${previousTitle}"`);

  try {
    // Get user by username
    const users = await UserModel.find({
      where: { username },
      selectionSet: `{ username }`
    });

    if (!users.length) {
      console.log('User not found');
      return null;
    }

    // Create new TextVersion for previous title
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await TextVersionModel.create({
      input: [{
        body: previousTitle,
        Author: {
          connect: { where: { node: { username } } }
        }
      }]
    });

    if (!textVersionResult.textVersions.length) {
      console.log('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current discussion to get current title version order
    const discussions = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: `{
        id
      }`
    });

    if (!discussions.length) {
      console.log('Discussion not found when updating version order');
      return null;
    }
    
    // Update discussion to connect the new TextVersion
    await DiscussionModel.update({
      where: { id: discussionId },
      update: {
        PastTitleVersions: {
          connect: [{ 
            where: { 
              node: { id: textVersionId } 
            } 
          }]
        }
      }
    });

    console.log(`Successfully added title version history for discussion ${discussionId}`);
    return textVersionId;
  } catch (error) {
    console.error('Error tracking title version history:', error);
    return null;
  }
}

/**
 * Track body version history for a discussion
 */
async function trackBodyVersionHistory(
  discussionId: string,
  previousBody: string,
  username: string,
  DiscussionModel: any,
  TextVersionModel: any,
  UserModel: any
): Promise<string | null> {
  console.log(`Tracking body version history for discussion ${discussionId}`);

  try {
    // Skip tracking if previous body is null or empty
    if (!previousBody) {
      console.log('Previous body is empty, skipping version history');
      return null;
    }

    // Get user by username
    const users = await UserModel.find({
      where: { username },
      selectionSet: `{ username }`
    });

    if (!users.length) {
      console.log('User not found');
      return null;
    }

    // Create new TextVersion for previous body
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await TextVersionModel.create({
      input: [{
        body: previousBody,
        Author: {
          connect: { where: { node: { username } } }
        }
      }]
    });

    if (!textVersionResult.textVersions.length) {
      console.log('Failed to create TextVersion');
      return null;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current discussion
    const discussions = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: `{
        id
      }`
    });

    if (!discussions.length) {
      console.log('Discussion not found when updating version order');
      return null;
    }

    // Update discussion to connect the new TextVersion
    await DiscussionModel.update({
      where: { id: discussionId },
      update: {
        PastBodyVersions: {
          connect: [{ 
            where: { 
              node: { id: textVersionId } 
            } 
          }]
        }
      }
    });

    console.log(`Successfully added body version history for discussion ${discussionId}`);
    return textVersionId;
  } catch (error) {
    console.error('Error tracking body version history:', error);
    return null;
  }
}
