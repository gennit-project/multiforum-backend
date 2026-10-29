import { parse, subscribe } from 'graphql';
import { trackTextVersion } from './textVersionHistory.js';
import type { VersionHistoryRepository } from './persistence/versionHistoryRepository.js';
import { logger } from "../logger.js";
import type { GraphQLSchema, ExecutionResult } from "graphql";
import { SubscriptionConsumer } from './subscriptionConsumer.js';

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
  repository: VersionHistoryRepository,
  wikiPageId: string
): Promise<string | null> => {
  try {
    return await repository.getWikiPageVersionAuthorUsername(wikiPageId);
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
  repository: VersionHistoryRepository,
  wikiPageId: string,
  content: string,
  editReason: string | null | undefined,
  username: string
): Promise<string | null> =>
  trackTextVersion(repository, {
    target: 'wiki-page',
    body: content,
    editReason,
    username,
    parentId: wikiPageId,
  });

/**
 * Handle a single wikiPage update event: resolve the version author, then
 * record a version for whichever of title/body actually changed. Callable core
 * of the subscription handler, extracted so it can be tested directly.
 */
export const handleWikiPageUpdateEvent = async (
  repository: VersionHistoryRepository,
  updatedWikiPage: WikiPageUpdatePayload,
  previousState: WikiPagePreviousState | null | undefined
): Promise<void> => {
  const wikiPageId = updatedWikiPage.id;
  const currentUsername = await getWikiPageVersionAuthorUsername(repository, wikiPageId);
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
      repository,
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
      repository,
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
  private schema: GraphQLSchema;
  private repository: VersionHistoryRepository;
  private consumer: SubscriptionConsumer;

  constructor(schema: GraphQLSchema, repository: VersionHistoryRepository) {
    this.schema = schema;
    this.repository = repository;
    this.consumer = new SubscriptionConsumer('wikiPageVersionHistory', () => this.subscribe(), (result) => this.processEvent(result));
    logger.info('WikiPage version history service initialized');
  }

  /**
   * Start listening for wikiPage update events
   */
  start(): Promise<void> {
    return this.consumer.start();
  }

  private async subscribe() {
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
    return subscribe({
      schema: this.schema,
      document: parse(wikiPageSubscription),
    });

  }

  private async processEvent(result: ExecutionResult): Promise<void> {
    const event = result.data?.wikiPageUpdated as { updatedWikiPage: WikiPageUpdatePayload; previousState?: WikiPagePreviousState | null } | undefined;
    if (!event) {
      logger.info('Received invalid wikiPage update event:');
      return;
    }

    const updatedWikiPage = event.updatedWikiPage;
    const previousState = event.previousState;

    logger.info('Processing version history for updated wikiPage:', updatedWikiPage.id);

    try {
      await handleWikiPageUpdateEvent(this.repository, updatedWikiPage, previousState);
    } catch (error) {
      logger.error('Error processing wikiPage version history:', error);
      // Continue processing other events even if one fails
    }
  }

  stop(): Promise<void> {
    return this.consumer.stop();
  }
}
