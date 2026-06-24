import { getChannelContributionsQuery } from "../cypher/cypherQueries.js";
import { DateTime } from "luxon";
import type { Driver } from "neo4j-driver";
import type { Record as Neo4jRecord } from "neo4j-driver";
import type { ChannelModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

interface Input {
  Channel: ChannelModel;
  driver: Driver;
}

interface Args {
  channelUniqueName: string;
  startDate?: string;
  endDate?: string;
  year?: number;
  limit?: number;
}

const getChannelContributionsResolver = (input: Input) => {
  const { driver, Channel } = input;

  return async (_parent: unknown, args: Args) => {
    const { channelUniqueName, year, startDate, endDate, limit } = args;
    const session = driver.session({ defaultAccessMode: 'READ' });

    try {
      // Verify channel existence
      const channelExists = await Channel.find({
        where: { uniqueName: channelUniqueName },
        selectionSet: `{ uniqueName }`,
      });

      if (channelExists.length === 0) {
        throw new Error(`Channel ${channelUniqueName} not found.`);
      }

      // Determine effective date range
      const effectiveStartDate = year
        ? `${year}-01-01`
        : (startDate || DateTime.now().minus({ year: 1 }).toISODate());

      const effectiveEndDate = year
        ? `${year}-12-31`
        : (endDate || DateTime.now().toISODate());

      // Execute optimized Cypher query
      logger.info('Query parameters:', {
        channelUniqueName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        limit: parseInt(String(limit || 10), 10),
      });

      // Debug: Test each step of the query
      const debugQuery1 = `MATCH (channel:Channel {uniqueName: $channelUniqueName}) RETURN channel.uniqueName`;
      const debug1 = await session.run(debugQuery1, { channelUniqueName });
      logger.info('Debug 1 - Channel found:', debug1.records.length > 0);

      const debugQuery2 = `
        MATCH (channel:Channel {uniqueName: $channelUniqueName})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
        RETURN count(dc) as dcCount
      `;
      const debug2 = await session.run(debugQuery2, { channelUniqueName });
      logger.info('Debug 2 - DiscussionChannels found:', debug2.records[0]?.get('dcCount').toNumber());

      const debugQuery3 = `
        MATCH (channel:Channel {uniqueName: $channelUniqueName})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
        RETURN count(d) as discussionCount
      `;
      const debug3 = await session.run(debugQuery3, { channelUniqueName });
      logger.info('Debug 3 - Discussions found via DiscussionChannel:', debug3.records[0]?.get('discussionCount').toNumber());

      const debugQuery4 = `
        MATCH (channel:Channel {uniqueName: $channelUniqueName})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
        MATCH (u:User)-[:POSTED_DISCUSSION]->(d)
        RETURN count(u) as userCount
      `;
      const debug4 = await session.run(debugQuery4, { channelUniqueName });
      logger.info('Debug 4 - Users found:', debug4.records[0]?.get('userCount').toNumber());

      const debugQuery5 = `
        MATCH (channel:Channel {uniqueName: $channelUniqueName})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
        RETURN d.createdAt as createdAt,
               date(datetime(d.createdAt)) as dateOnly,
               toString(d.createdAt) as createdAtString
        LIMIT 5
      `;
      const debug5 = await session.run(debugQuery5, { channelUniqueName });
      logger.info('Debug 5 - Sample Discussion createdAt values:');
      debug5.records.forEach((r: Neo4jRecord) => {
        logger.info('  - Raw:', r.get('createdAt'));
        logger.info('    Date:', r.get('dateOnly'));
        logger.info('    String:', r.get('createdAtString'));
      });

      const debugQuery6 = `
        RETURN date($startDate) as parsedStartDate,
               date($endDate) as parsedEndDate
      `;
      const debug6 = await session.run(debugQuery6, {
        startDate: effectiveStartDate,
        endDate: effectiveEndDate
      });
      logger.info('Debug 6 - Date parsing:');
      logger.info('  Start date string:', effectiveStartDate);
      logger.info('  Parsed start:', debug6.records[0]?.get('parsedStartDate'));
      logger.info('  End date string:', effectiveEndDate);
      logger.info('  Parsed end:', debug6.records[0]?.get('parsedEndDate'));

      const debugQuery7 = `
        MATCH (channel:Channel {uniqueName: $channelUniqueName})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
        MATCH (dc)-[:POSTED_IN_CHANNEL]->(d:Discussion)
        MATCH (u:User)-[:POSTED_DISCUSSION]->(d)
        WITH d, date(datetime(d.createdAt)) as discussionDate, date($startDate) as startDate, date($endDate) as endDate
        RETURN discussionDate, startDate, endDate,
               discussionDate >= startDate as afterStart,
               discussionDate <= endDate as beforeEnd
        LIMIT 5
      `;
      const debug7 = await session.run(debugQuery7, {
        channelUniqueName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate
      });
      logger.info('Debug 7 - Date comparisons:');
      debug7.records.forEach((r: Neo4jRecord) => {
        logger.info('  Discussion:', r.get('discussionDate'), 'Start:', r.get('startDate'), 'End:', r.get('endDate'));
        logger.info('    After start?', r.get('afterStart'), 'Before end?', r.get('beforeEnd'));
      });

      const result = await session.run(getChannelContributionsQuery, {
        channelUniqueName,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        limit: parseInt(String(limit || 10), 10),
      });

      logger.info('Query returned', result.records.length, 'records');

      // Map results to UserContributionData format
      const contributions = result.records.map((record: Neo4jRecord) => {
        const dayData = record.get('dayData');

        // Log the dayData to debug null date issue
        logger.info('Raw dayData:', JSON.stringify(dayData, null, 2));

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
