import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Input = {
  driver: Driver;
};

type Args = {
  limit?: string;
  offset?: string;
  tags?: string[];
  searchInput?: string;
  countDownloads?: boolean | null;
};

const DEFAULT_LIMIT = "25";
const DEFAULT_OFFSET = "0";

const getSortedChannelsResolver = (input: Input) => {
  const { driver } = input;

  return async (_parent: unknown, args: Args, context?: GraphQLContext) => {
    const limit = args.limit || DEFAULT_LIMIT;
    const offset = args.offset || DEFAULT_OFFSET;
    const tags = args.tags || [];
    const searchInput = args.searchInput || "";
    const countDownloads = args.countDownloads;
    if (context) {
      context.user = await setUserDataOnContext({ context });
    }
    const loggedInUsername = context?.user?.username || null;
    const session = driver.session();

    try {
      const result = await session.run(
        `
        // Match channels that match the search input
        MATCH (c:Channel)
        WHERE $searchInput = "" 
          OR toLower(c.uniqueName) CONTAINS toLower($searchInput)
          OR toLower(c.description) CONTAINS toLower($searchInput)
        
        // Optional match to tags for filtering
        OPTIONAL MATCH (c)-[:HAS_TAG]->(t:Tag)
        WITH c, COLLECT(DISTINCT t) AS tags
        WHERE SIZE($tags) = 0 OR ANY(tag IN tags WHERE tag.text IN $tags)
        
        // Count DiscussionChannels based on countDownloads flag
        CALL {
          WITH c
          MATCH (c)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
          MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
          WHERE CASE 
            WHEN $countDownloads IS NULL THEN (d.hasDownload IS NULL OR d.hasDownload = false)
            WHEN $countDownloads = true THEN d.hasDownload = true
            WHEN $countDownloads = false THEN (d.hasDownload IS NULL OR d.hasDownload = false)
            ELSE true
          END
          RETURN COUNT(DISTINCT dc) AS validDiscussionChannelsCount
        }
        
        // Count EventChannels with valid endTime
        CALL {
          WITH c
          MATCH (c)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)
          MATCH (ec)-[:POSTED_IN_CHANNEL]->(e:Event)
          WHERE e.endTime > datetime()
          RETURN COUNT(DISTINCT ec) AS eventChannelsCount
        }
        
        OPTIONAL MATCH (favUser:User {username: $loggedInUsername})-[:DEFAULT_FAVORITES_CHANNELS]->(c)
        
        // Collect tags again for the final output
        WITH c, tags, validDiscussionChannelsCount, eventChannelsCount, COUNT(DISTINCT favUser) > 0 AS isFavorited
        
        // Aggregate channel count
        WITH collect({
          uniqueName: c.uniqueName,
          displayName: c.displayName,
          channelIconURL: c.channelIconURL,
          description: c.description,
          isFavorited: CASE WHEN $loggedInUsername IS NULL OR $loggedInUsername = "" THEN null ELSE isFavorited END,
          Tags: [tag IN tags | { text: tag.text }],
          EventChannelsAggregate: { count: eventChannelsCount },
          DiscussionChannelsAggregate: { count: validDiscussionChannelsCount }
        }) AS channels, COUNT(c) AS aggregateChannelCount
        
        // Paginate results
        UNWIND channels AS channel
        RETURN 
          channel, 
          aggregateChannelCount
        SKIP toInteger($offset)
        LIMIT toInteger($limit)
        `,
        {
          limit,
          offset,
          tags,
          searchInput,
          countDownloads,
          loggedInUsername,
        }
      );

      const channels = result.records.map((record: Neo4jRecord) =>
        record.get("channel")
      );

      const aggregateChannelCount =
        result.records.length > 0
          ? result.records[0].get("aggregateChannelCount")
          : 0;

      return { channels, aggregateChannelCount };
    } catch (error) {
      logger.error("Error fetching sorted channels:", error);
      throw new Error("Failed to fetch sorted channels");
    } finally {
      await session.close();
    }
  };
};

export default getSortedChannelsResolver;
