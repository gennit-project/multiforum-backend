import { getSiteWideWikiPagesQuery } from "../cypher/cypherQueries.js";

type Input = {
  driver: any;
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

  return async (_parent: any, args: Args) => {
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

      const wikiPages = result.records.map((record: any) =>
        record.get("wikiPage")
      );

      return {
        wikiPages,
        aggregateWikiPageCount: totalCount,
      };
    } catch (error: any) {
      console.error("Error getting wiki pages:", error);
      throw new Error(`Failed to fetch wiki pages. ${error.message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
