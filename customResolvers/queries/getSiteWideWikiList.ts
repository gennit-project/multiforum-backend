import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { getSiteWideWikiPagesQuery } from "../cypher/cypherQueries.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
};

type Args = {
  searchInput?: string;
  selectedChannels?: string[];
  options?: {
    offset?: number;
    limit?: number;
  };
};

const getResolver = (input: Input) => {
  const { driver } = input;

  return async (_parent: unknown, args: Args) => {
    const {
      searchInput = "",
      selectedChannels = [],
      options,
    } = args;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 25;
    const titleRegex = `(?i).*${searchInput}.*`;
    const bodyRegex = `(?i).*${searchInput}.*`;

    const session = driver.session();
    let totalCount = 0;

    try {
      const result = await session.run(getSiteWideWikiPagesQuery, {
        searchInput,
        titleRegex,
        bodyRegex,
        selectedChannels,
        offset,
        limit,
      });

      const record = result.records[0];
      if (record) {
        totalCount = record.get("totalCount");
      }

      const wikiPages = result.records.map((record: Neo4jRecord) =>
        record.get("wikiPage")
      );

      return {
        wikiPages,
        aggregateWikiPageCount: totalCount,
      };
    } catch (error: unknown) {
      logger.error("Error getting wiki pages:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch wiki pages. ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
