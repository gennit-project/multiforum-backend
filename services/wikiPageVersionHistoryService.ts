import { execute, parse, subscribe } from 'graphql';
import type { TextVersionCreateInput } from "../src/generated/graphql.js";

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

/**
 * WikiPage Version History Service that listens to WikiPage update events
 * and tracks version history of title and body changes
 */
export class WikiPageVersionHistoryService {
  private schema: any;
  private ogm: any;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: any, ogm: any) {
    this.schema = schema;
    this.ogm = ogm;
    console.log('WikiPage version history service initialized');
  }

  /**
   * Start listening for wikiPage update events
   */
  async start() {
    if (this.isRunning) {
      console.log('WikiPage version history service is already running');
      return;
    }

    try {
      console.log('Starting wikiPage version history service...');
      this.isRunning = true;

      // Define the subscription query to listen for wikiPage update events
      const wikiPageSubscription = `
        subscription {
          wikiPageUpdated {
            updatedWikiPage {
              id
              title
              body
              editReason
              updatedAt
            }
            previousState {
              id
              title
              body
              editReason
            }
          }
        }
      `;

      // Subscribe to wikiPage update events
      const result = await subscribe({
        schema: this.schema,
        document: parse(wikiPageSubscription),
        contextValue: { ogm: this.ogm }
      });

      // Check if result is an AsyncIterator (subscription succeeded)
      if (Symbol.asyncIterator in result) {
        this.subscriptionIterator = result as AsyncIterableIterator<any>;

        // Start processing wikiPage update events
        this.processWikiPageUpdateEvents();
        console.log('WikiPage version history service started');
      } else {
        // If not an AsyncIterator, it's an error result
        console.error('Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      console.error('Error starting wikiPage version history service:', error);
      this.isRunning = false;
    }
  }

  /**
   * Process wikiPage update events and track version history
   */
  private async processWikiPageUpdateEvents() {
    if (!this.subscriptionIterator) return;

    try {
      // Process each wikiPage update event as it arrives
      for await (const result of this.subscriptionIterator) {
        if (!result.data?.wikiPageUpdated) {
          console.log('Received invalid wikiPage update event:', result);
          continue;
        }

        const updatedWikiPage = result.data.wikiPageUpdated.updatedWikiPage;
        const previousState = result.data.wikiPageUpdated.previousState;
        const wikiPageId = updatedWikiPage.id;
        
        console.log('Processing version history for updated wikiPage:', wikiPageId);

        try {
          // Get the current user who made the update from the WikiPage's VersionAuthor
          const currentUsername = await this.getCurrentUserUsername(wikiPageId);
          
          if (!currentUsername) {
            console.log('Could not determine current user, skipping version history');
            continue;
          }

          // Check if title has changed - save the NEW title as a version
          if (previousState?.title && previousState.title !== updatedWikiPage.title) {
            await this.trackVersionHistory(
              wikiPageId, 
              updatedWikiPage.title,
              updatedWikiPage.editReason,
              currentUsername
            );
          }

          // Check if body has changed - save the NEW body as a version
          if (previousState?.body && previousState.body !== updatedWikiPage.body) {
            await this.trackVersionHistory(
              wikiPageId, 
              updatedWikiPage.body,
              updatedWikiPage.editReason,
              currentUsername
            );
          }
        } catch (error) {
          console.error('Error processing wikiPage version history:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      console.error('Error in wikiPage update event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        console.log('Restarting wikiPage version history service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Get the current user who made the update from the WikiPage's VersionAuthor
   */
  private async getCurrentUserUsername(wikiPageId: string): Promise<string | null> {
    try {
      const WikiPageModel = this.ogm.model('WikiPage');
      const wikiPages = await WikiPageModel.find({
        where: { id: wikiPageId },
        selectionSet: `{
          VersionAuthor {
            username
          }
        }`
      });

      if (!wikiPages.length || !wikiPages[0].VersionAuthor?.username) {
        return null;
      }

      return wikiPages[0].VersionAuthor.username;
    } catch (error) {
      console.error('Error getting current user username:', error);
      return null;
    }
  }


  /**
   * Track version history for a wikiPage
   */
  private async trackVersionHistory(
    wikiPageId: string,
    content: string,
    editReason: string | null | undefined,
    username: string
  ) {
    // Get the OGM models
    const WikiPageModel = this.ogm.model('WikiPage');
    const TextVersionModel = this.ogm.model('TextVersion');
    const UserModel = this.ogm.model('User');

    console.log(`Tracking version history for wikiPage ${wikiPageId} by user ${username}`);

    try {
      // Skip tracking if content is null or empty
      if (!content) {
        console.log('Content is empty, skipping version history');
        return;
      }

      // Get user by username
      const users = await UserModel.find({
        where: { username },
        selectionSet: `{ username }`
      });

      if (!users.length) {
        console.log('User not found:', username);
        return;
      }

      // Create new TextVersion for the new content
      // The createdAt timestamp will be automatically set by @timestamp directive
      const textVersionInput: TextVersionCreateInput = {
        body: content,
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
        }
      });

      console.log(`Successfully added version history for wikiPage ${wikiPageId}`);
    } catch (error) {
      console.error('Error tracking version history:', error);
      throw error;
    }
  }

  /**
   * Stop the wikiPage version history service
   */
  stop() {
    console.log('Stopping wikiPage version history service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
