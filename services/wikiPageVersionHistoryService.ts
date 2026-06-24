import { execute, parse, subscribe } from 'graphql';
import { trackTextVersion, type OGMLike } from './textVersionHistory.js';
import { logger } from "../logger.js";

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

export interface WikiPageUpdatePayload {
  id: string;
  title?: string | null;
  body?: string | null;
  editReason?: string | null;
}

export interface WikiPagePreviousState {
  title?: string | null;
  body?: string | null;
}

/**
 * Look up the username of a wikiPage's current VersionAuthor. Returns null if
 * the wikiPage or its version author cannot be found.
 */
export const getWikiPageVersionAuthorUsername = async (
  ogm: OGMLike,
  wikiPageId: string
): Promise<string | null> => {
  try {
    const WikiPageModel = ogm.model('WikiPage');
    const wikiPages = await WikiPageModel.find({
      where: { id: wikiPageId },
      selectionSet: `{ VersionAuthor { username } }`,
    });
    if (!wikiPages.length || !wikiPages[0].VersionAuthor?.username) {
      return null;
    }
    return wikiPages[0].VersionAuthor.username;
  } catch (error) {
    logger.error('Error getting current user username:', error);
    return null;
  }
};

/**
 * Track a wikiPage version by saving the given content as a TextVersion
 * (with optional editReason) connected to PastVersions.
 */
export const trackWikiPageVersion = (
  ogm: OGMLike,
  wikiPageId: string,
  content: string,
  editReason: string | null | undefined,
  username: string
): Promise<string | null> =>
  trackTextVersion(ogm, {
    body: content,
    editReason,
    username,
    parentModelName: 'WikiPage',
    parentId: wikiPageId,
    relationshipField: 'PastVersions',
  });

/**
 * Handle a single wikiPage update event: resolve the version author, then
 * record a version for whichever of title/body actually changed. Callable core
 * of the subscription handler, extracted so it can be tested directly.
 */
export const handleWikiPageUpdateEvent = async (
  ogm: OGMLike,
  updatedWikiPage: WikiPageUpdatePayload,
  previousState: WikiPagePreviousState | null | undefined
): Promise<void> => {
  const wikiPageId = updatedWikiPage.id;
  const currentUsername = await getWikiPageVersionAuthorUsername(ogm, wikiPageId);
  if (!currentUsername) {
    logger.info('Could not determine current user, skipping version history');
    return;
  }

  if (
    previousState?.title &&
    previousState.title !== updatedWikiPage.title &&
    updatedWikiPage.title
  ) {
    await trackWikiPageVersion(
      ogm,
      wikiPageId,
      updatedWikiPage.title,
      updatedWikiPage.editReason,
      currentUsername
    );
  }

  if (
    previousState?.body &&
    previousState.body !== updatedWikiPage.body &&
    updatedWikiPage.body
  ) {
    await trackWikiPageVersion(
      ogm,
      wikiPageId,
      updatedWikiPage.body,
      updatedWikiPage.editReason,
      currentUsername
    );
  }
};

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
    logger.info('WikiPage version history service initialized');
  }

  /**
   * Start listening for wikiPage update events
   */
  async start() {
    if (this.isRunning) {
      logger.info('WikiPage version history service is already running');
      return;
    }

    try {
      logger.info('Starting wikiPage version history service...');
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
        logger.info('WikiPage version history service started');
      } else {
        // If not an AsyncIterator, it's an error result
        logger.error('Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      logger.error('Error starting wikiPage version history service:', error);
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
          logger.info('Received invalid wikiPage update event:', result);
          continue;
        }

        const updatedWikiPage = result.data.wikiPageUpdated.updatedWikiPage;
        const previousState = result.data.wikiPageUpdated.previousState;

        logger.info('Processing version history for updated wikiPage:', updatedWikiPage.id);

        try {
          await handleWikiPageUpdateEvent(this.ogm, updatedWikiPage, previousState);
        } catch (error) {
          logger.error('Error processing wikiPage version history:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      logger.error('Error in wikiPage update event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        logger.info('Restarting wikiPage version history service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Stop the wikiPage version history service
   */
  stop() {
    logger.info('Stopping wikiPage version history service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
