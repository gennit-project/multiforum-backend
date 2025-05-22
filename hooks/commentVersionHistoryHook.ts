/**
 * Hook to track comment version history when a comment is updated
 * This will capture the old text before the update is applied
 */
export const commentVersionHistoryHandler = async ({ context, params }: any) => {
  try {
    console.log('Comment version history hook running...');
    
    // Extract parameters from the update operation
    const { where, update } = params;
    const commentId = where?.id;
    
    // Make sure we have a comment ID and update data
    if (!commentId || !update) {
      console.log('Missing comment ID or update data');
      return;
    }
    
    // Check if text is being updated
    const isTextUpdated = update.text !== undefined;
    
    // If text is not being updated, skip version tracking
    if (!isTextUpdated) {
      console.log('No text updates detected, skipping version history');
      return;
    }
    
    console.log('Processing version history for comment:', commentId);
    
    // Access OGM models
    const { ogm } = context;
    const CommentModel = ogm.model('Comment');
    const TextVersionModel = ogm.model('TextVersion');
    const UserModel = ogm.model('User');
    
    // Fetch the current comment to get current values before update
    const comments = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{
        id
        text
        CommentAuthor {
          ... on User {
            username
          }
          ... on ModerationProfile {
            displayName
          }
        }
        PastVersions {
          id
          body
          createdAt
        }
      }`
    });

    if (!comments.length) {
      console.log('Comment not found');
      return;
    }

    const comment = comments[0];
    
    // Get the username from CommentAuthor which can be either User or ModerationProfile
    const commentAuthor = comment.CommentAuthor;
    if (!commentAuthor) {
      console.log('Comment author information not found');
      return;
    }
    
    const username = commentAuthor.username || commentAuthor.displayName;
    
    if (!username) {
      console.log('Author username or displayName not found');
      console.log('CommentAuthor data:', JSON.stringify(commentAuthor));
      return;
    }
    
    // Track text version history if text is being updated
    if (isTextUpdated && update.text !== comment.text && comment.text) {
      await trackTextVersionHistory(
        commentId,
        comment.text,
        username,
        CommentModel,
        TextVersionModel,
        UserModel
      );
    } else {
      console.log('No text changes to track or current text is empty');
    }
  } catch (error) {
    console.error('Error in comment version history hook:', error);
    // Don't re-throw the error, so we don't affect the mutation
  }
};

/**
 * Track text version history for a comment
 */
async function trackTextVersionHistory(
  commentId: string,
  previousText: string,
  username: string,
  CommentModel: any,
  TextVersionModel: any,
  UserModel: any
) {
  console.log(`Tracking text version history for comment ${commentId}`);

  try {
    // Skip tracking if previous text is null or empty
    if (!previousText) {
      console.log('Previous text is empty, skipping version history');
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

    // Create new TextVersion for previous text
    // The createdAt timestamp will be automatically set by @timestamp directive
    const textVersionResult = await TextVersionModel.create({
      input: [{
        body: previousText,
        Author: {
          connect: { where: { node: { username } } }
        }
      }]
    });

    if (!textVersionResult.textVersions.length) {
      console.log('Failed to create TextVersion');
      return;
    }

    const textVersionId = textVersionResult.textVersions[0].id;

    // Fetch the current comment
    const comments = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{
        id
      }`
    });

    if (!comments.length) {
      console.log('Comment not found when updating version order');
      return;
    }

    // Update comment to connect the new TextVersion
    await CommentModel.update({
      where: { id: commentId },
      update: {
        PastVersions: {
          connect: [{ 
            where: { 
              node: { id: textVersionId } 
            } 
          }]
        }
      }
    });

    console.log(`Successfully added text version history for comment ${commentId}`);
  } catch (error) {
    console.error('Error tracking text version history:', error);
  }
}