import {
  createContributionTargetRepository,
  type ContributionTargetRepository,
} from "../../services/persistence/contributionTargetRepository.js";
import { getModContributionsQuery } from "../cypher/cypherQueries.js";
import { DateTime } from "luxon";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { mayAccessSensitiveContent as resolveSensitiveContentAccess } from "../../services/sensitiveContentAccess.js";
import { logger } from "../../logger.js";

interface Input {
  contributionTargetRepository?: ContributionTargetRepository;
  driver: Driver;
  agePolicyRepository?: AgePolicyReader;
}

interface Args {
  displayName: string;
  startDate?: string;
  endDate?: string;
  year?: number;
}

const getModContributionsResolver = (input: Input) => {
  const { driver, agePolicyRepository } = input;
  const targets = input.contributionTargetRepository ?? createContributionTargetRepository(driver);

  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    const { displayName, year, startDate, endDate } = args;
    const mayAccessSensitiveContent = await resolveSensitiveContentAccess({
      context,
      driver,
      agePolicyRepository,
    });
    const session = driver.session();

    try {
      const modExists = await targets.moderationProfileExists(displayName);

      if (!modExists) {
        throw new Error(`Moderation profile ${displayName} not found.`);
      }

      const effectiveStartDate = year
        ? `${year}-01-01`
        : (startDate || DateTime.utc().minus({ year: 1 }).toISODate());

      const effectiveEndDate = year
        ? `${year}-12-31`
        : (endDate || DateTime.utc().toISODate());

      const result = await session.run(getModContributionsQuery, {
        displayName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        mayAccessSensitiveContent,
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
      logger.error("Error fetching mod contributions:", error);
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
