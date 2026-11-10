import { canonicalChannelContribution } from '../../services/canonicalContributionSources.js';
import type { ChannelContributionRow, ContributionDay } from "../contracts/contributionReadProjections.js";
import {
  createContributionTargetRepository,
  type ContributionTargetRepository,
} from "../../services/persistence/contributionTargetRepository.js";
import { getChannelContributionsQuery } from "../cypher/cypherQueries.js";
import { DateTime } from "luxon";
import type { Driver } from "neo4j-driver";
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
  startDate?: string | null;
  endDate?: string | null;
  year?: number | null;
  limit?: number | null;
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

      const result = await session.run<ChannelContributionRow>(getChannelContributionsQuery, {
        channelUniqueName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        limit: parseInt(String(limit || 10), 10),
        mayAccessSensitiveContent,
      });

      // Map results to UserContributionData format
      const contributions = result.records.map((record) => {
        const dayData = record.get('dayData');

        // Filter out any dayData entries with null dates
        const validDayData = Array.isArray(dayData)
          ? dayData.filter((day): day is ContributionDay & { date: string } => Boolean(day && day.date != null))
          : [];

        const count = record.get('totalContributions');
        return canonicalChannelContribution({
          username: record.get('username'),
          displayName: record.get('displayName'),
          profilePicURL: record.get('profilePicURL'),
          totalContributions: typeof count === 'number' ? count : count.toNumber(),
          dayData: validDayData,
        });
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
