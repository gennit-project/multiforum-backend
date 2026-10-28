import {
  createContributionTargetRepository,
  type ContributionTargetRepository,
} from "../../services/persistence/contributionTargetRepository.js";
import { getChannelContributionsQuery } from "../cypher/cypherQueries.js";
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
  channelUniqueName: string;
  startDate?: string;
  endDate?: string;
  year?: number;
  limit?: number;
}

const getChannelContributionsResolver = (input: Input) => {
  const { driver, agePolicyRepository } = input;
  const targets = input.contributionTargetRepository ?? createContributionTargetRepository(driver);

  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    const { channelUniqueName, year, startDate, endDate, limit } = args;
    const mayAccessSensitiveContent = await resolveSensitiveContentAccess({
      context,
      driver,
      agePolicyRepository,
    });
    const session = driver.session();

    try {
      // Verify channel existence
      const channelExists = await targets.channelExists(channelUniqueName);

      if (!channelExists) {
        throw new Error(`Channel ${channelUniqueName} not found.`);
      }

      // Determine effective date range
      const effectiveStartDate = year
        ? `${year}-01-01`
        : (startDate || DateTime.utc().minus({ year: 1 }).toISODate());

      const effectiveEndDate = year
        ? `${year}-12-31`
        : (endDate || DateTime.utc().toISODate());

      const result = await session.run(getChannelContributionsQuery, {
        channelUniqueName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        limit: parseInt(String(limit || 10), 10),
        mayAccessSensitiveContent,
      });

      // Map results to UserContributionData format
      const contributions = result.records.map((record: Neo4jRecord) => {
        const dayData = record.get('dayData');

        // Filter out any dayData entries with null dates
        const validDayData = Array.isArray(dayData)
          ? dayData.filter((day: { date?: unknown } | null) => day && day.date != null)
          : [];

        return {
          username: record.get('username'),
          displayName: record.get('displayName'),
          profilePicURL: record.get('profilePicURL'),
          totalContributions: record.get('totalContributions').toNumber
            ? record.get('totalContributions').toNumber()
            : record.get('totalContributions'),
          dayData: validDayData,
        };
      });

      return contributions;

    } catch (error: unknown) {
      logger.error("Error fetching channel contributions:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch contributions for channel ${channelUniqueName}: ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getChannelContributionsResolver;
