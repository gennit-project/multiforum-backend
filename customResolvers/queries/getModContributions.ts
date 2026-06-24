import { getModContributionsQuery } from "../cypher/cypherQueries.js";
import { DateTime } from "luxon";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import type { ModerationProfileModel } from "../../ogm_types.js";

interface Input {
  ModerationProfile: ModerationProfileModel;
  driver: Driver;
}

interface Args {
  displayName: string;
  startDate?: string;
  endDate?: string;
  year?: number;
}

const getModContributionsResolver = (input: Input) => {
  const { driver, ModerationProfile } = input;

  return async (_parent: unknown, args: Args) => {
    const { displayName, year, startDate, endDate } = args;
    const session = driver.session({ defaultAccessMode: 'READ' });

    try {
      const modExists = await ModerationProfile.find({
        where: { displayName },
        selectionSet: `{ displayName }`,
      });

      if (modExists.length === 0) {
        throw new Error(`Moderation profile ${displayName} not found.`);
      }

      const effectiveStartDate = year
        ? `${year}-01-01`
        : (startDate || DateTime.now().minus({ year: 1 }).toISODate());

      const effectiveEndDate = year
        ? `${year}-12-31`
        : (endDate || DateTime.now().toISODate());

      const result = await session.run(getModContributionsQuery, {
        displayName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });

      const contributions = result.records
        .map((record: Neo4jRecord) => {
          const date = record.get('date');
          if (!date) {
            return null;
          }
          return {
            date,
            count: record.get('count').toNumber
              ? record.get('count').toNumber()
              : record.get('count'),
            activities: record.get('activities'),
          };
        })
        .filter((contribution) => contribution !== null);

      return contributions;
    } catch (error: unknown) {
      console.error("Error fetching mod contributions:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch contributions for mod ${displayName}: ${message}`
      );
    } finally {
      await session.close();
    }
  };
};

export default getModContributionsResolver;
