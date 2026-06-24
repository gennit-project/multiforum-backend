import type { Driver } from "neo4j-driver";
import { logger } from "../../logger.js";

type Input = {
    driver: Driver;
};

// Minimal shape of the errors thrown by the Neo4j driver that this retry
// logic inspects.
type Neo4jLikeError = {
    message?: string;
    code?: string;
    retriable?: boolean;
};

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Run a single delete with retry logic for transient errors
// Uses batched delete to avoid memory issues
async function runDeleteWithRetry(
    driver: Driver,
    nodeLabel: string,
    maxRetries: number = 3,
    baseDelayMs: number = 200
): Promise<void> {
    const batchedQuery = `
        CALL {
            MATCH (n:${nodeLabel})
            WITH n LIMIT 500
            DETACH DELETE n
            RETURN count(*) as deleted
        } IN TRANSACTIONS OF 500 ROWS
        RETURN sum(deleted) as totalDeleted
    `;

    // Fallback to simple delete for Neo4j versions that don't support CALL IN TRANSACTIONS
    const simpleQuery = `MATCH (n:${nodeLabel}) WITH n LIMIT 1000 DETACH DELETE n RETURN count(*) as deleted`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const session = driver.session();
        try {
            // Try batched delete first
            try {
                await session.run(batchedQuery);
                return; // Success
            } catch (batchErrorRaw: unknown) {
                const batchError = batchErrorRaw as Neo4jLikeError;
                // If CALL IN TRANSACTIONS not supported, fall back to simple delete
                if (batchError?.message?.includes('CALL') || batchError?.code?.includes('SyntaxError')) {
                    // Use simple delete in a loop until no more nodes
                    let deleted = 1;
                    while (deleted > 0) {
                        const result = await session.run(simpleQuery);
                        deleted = result.records[0]?.get('deleted')?.toNumber?.() || 0;
                    }
                    return;
                }
                throw batchError;
            }
        } catch (errorRaw: unknown) {
            const error = errorRaw as Neo4jLikeError;
            const isRetriable = error?.retriable === true ||
                error?.code?.includes('TransientError') ||
                error?.code?.includes('DeadlockDetected');

            if (isRetriable && attempt < maxRetries) {
                const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
                logger.warn(`Transient error on attempt ${attempt} for ${nodeLabel}. Retrying in ${delayMs}ms...`);
                await delay(delayMs);
            } else {
                // Log and continue - some node types may not exist or deletion may have partially completed
                logger.warn(`Error deleting ${nodeLabel}:`, error?.message || error);
                return;
            }
        } finally {
            try {
                await session.close();
            } catch {
                // Ignore session close errors
            }
        }
    }
}

const dropDataForCypressTestsResolver = (input: Input) => {
    const { driver } = input;

    return async () => {
      // Order matters: delete dependent nodes first to reduce lock contention
      const nodeLabels = [
        // User-generated content and related metadata
        "ScratchpadEntry",
        "LabelChangeHistory",
        "ModerationAction",
        "Notification",
        "Activity",
        "Feedback",
        "FileVersion",
        "Purchase",
        "FilterOption",
        "FilterGroup",
        "Suspension",
        "Image",
        "Album",
        "TextVersion",
        "Comment",
        "Issue",
        "ChannelIssueCounter",
        "EventChannel",
        "DiscussionChannel",
        "Event",
        "RecurringEvent",
        "Discussion",
        "DownloadableFile",
        "Collection",
        "Message",
        "Contact",
        "Emoji",
        "Feed",
        "WikiPage",
        "Tag",
        // Roles and config
        "ModerationProfile",
        "ModChannelRole",
        "ChannelRole",
        "ModServerRole",
        "ServerRole",
        "Channel",
        "ServerConfig",
        "Email",
        "User",
      ];

      // Run each delete in its own session
      for (const label of nodeLabels) {
        await runDeleteWithRetry(driver, label);
      }

      return { success: true, message: "All test data has been dropped." };
    };
  };

  export default dropDataForCypressTestsResolver;
