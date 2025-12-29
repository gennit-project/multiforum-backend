import { getModContributionsQuery } from "../cypher/cypherQueries.js";
import { DateTime } from "luxon";

interface Input {
  ModerationProfile: any;
  driver: any;
}

interface Args {
  displayName: string;
  startDate?: string;
  endDate?: string;
  year?: number;
}

const getModContributionsResolver = (input: Input) => {
  const { driver, ModerationProfile } = input;

  return async (_parent: any, args: Args) => {
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
        .map((record: any) => {
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
        .filter((contribution: any) => contribution !== null);

      return contributions;
    } catch (error: any) {
      console.error("Error fetching mod contributions:", error);
      throw new Error(
        `Failed to fetch contributions for mod ${displayName}: ${error.message}`
      );
    } finally {
      await session.close();
    }
  };
};

export default getModContributionsResolver;
