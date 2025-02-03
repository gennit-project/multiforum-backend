import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { getDiscussionChannelsQuery } from "../cypher/cypherQueries.js";
import { timeFrameOptions } from "./utils.js";

enum timeFrameOptionKeys {
  year = "year",
  month = "month",
  week = "week",
  day = "day",
}

type Input = {
  DiscussionChannel: any;
  driver: any;
};

type Args = {
  channelUniqueName: string;
  options: {
    offset: string;
    limit: string;
    sort: string;
    timeFrame: timeFrameOptionKeys;
  };
  selectedTags: string[];
  searchInput: string;
  showArchived: boolean;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  return async (parent: any, args: Args, context: any, info: any) => {
    const { channelUniqueName, options, selectedTags, searchInput, showArchived } = args;
    const { offset, limit, sort, timeFrame } = options || {};
    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false
    });
  
    const loggedInUsername = context.user?.username || null;

    const session = driver.session();
    let titleRegex = `(?i).*${searchInput}.*`;
    let bodyRegex = `(?i).*${searchInput}.*`;

    try {
      let aggregateCount = 0;
      const queryParams = {
        searchInput,
        showArchived,
        titleRegex,
        bodyRegex,
        selectedTags: selectedTags || [],
        channelUniqueName,
        offset: parseInt(offset, 10),
        limit: parseInt(limit, 10),
        startOfTimeFrame: null,
        sortOption: "new",
        loggedInUsername
      };

      switch (sort) {
        case "new":
          const newDiscussionChannelsResult = await session.run(
            getDiscussionChannelsQuery,
            queryParams
          );

          const newDiscussionChannels = newDiscussionChannelsResult.records.map(
            (record: any) => {
              return record.get("DiscussionChannel");
            }
          );
          const firstResult = newDiscussionChannelsResult.records[0];
          if (firstResult) {
            aggregateCount = firstResult.get("totalCount");
          }

          return {
            discussionChannels: newDiscussionChannels,
            aggregateDiscussionChannelsCount: aggregateCount,
          };

        case "top":
          let selectedTimeFrame = null;

          if (timeFrameOptions[timeFrame]) {
            selectedTimeFrame = timeFrameOptions[timeFrame].start;
          }

          const topDiscussionChannelsResult = await session.run(
            getDiscussionChannelsQuery,
            {
              ...queryParams,
              startOfTimeFrame: selectedTimeFrame,
              sortOption: "top"
            }
          );

          const topDiscussionChannels = topDiscussionChannelsResult.records.map(
            (record: any) => {
              return record.get("DiscussionChannel");
            }
          );

          const firstTopResult = topDiscussionChannelsResult.records[0];
          if (firstTopResult) {
            aggregateCount = firstTopResult.get("totalCount");
          }

          return {
            discussionChannels: topDiscussionChannels,
            aggregateDiscussionChannelsCount: aggregateCount,
          };

        default:
          const hotDiscussionChannelsResult = await session.run(
            getDiscussionChannelsQuery,
            {
              ...queryParams,
              sortOption: "hot"
            }
          );

          const hotDiscussionChannels = hotDiscussionChannelsResult.records.map(
            (record: any) => {
              return record.get("DiscussionChannel");
            }
          );

          const firstHotResult = hotDiscussionChannelsResult.records[0];
          if (firstHotResult) {
            aggregateCount = firstHotResult.get("totalCount");
          }

          return {
            discussionChannels: hotDiscussionChannels,
            aggregateDiscussionChannelsCount: aggregateCount,
          };
      }
    } catch (error: any) {
      console.error("Error getting discussionChannels:", error);
      throw new Error(
        `Failed to fetch discussionChannels in channel. ${error.message}`
      );
    } finally {
      session.close();
    }
  };
};

export default getResolver;