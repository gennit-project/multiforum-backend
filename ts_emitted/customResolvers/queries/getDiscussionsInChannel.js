import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { getDiscussionChannelsQuery } from "../cypher/cypherQueries.js";
import { timeFrameOptions } from "./utils.js";
var timeFrameOptionKeys;
(function (timeFrameOptionKeys) {
    timeFrameOptionKeys["year"] = "year";
    timeFrameOptionKeys["month"] = "month";
    timeFrameOptionKeys["week"] = "week";
    timeFrameOptionKeys["day"] = "day";
})(timeFrameOptionKeys || (timeFrameOptionKeys = {}));
const getResolver = (input) => {
    const { driver } = input;
    return async (parent, args, context, info) => {
        var _a;
        const { channelUniqueName, options, selectedTags, searchInput, showArchived, showUnanswered, hasDownload, labelFilters } = args;
        const { offset, limit, sort, timeFrame } = options || {};
        // Set loggedInUsername to null explicitly if not present
        context.user = await setUserDataOnContext({
            context,
            getPermissionInfo: false
        });
        const loggedInUsername = ((_a = context.user) === null || _a === void 0 ? void 0 : _a.username) || null;
        const hasDownloadFilter = typeof hasDownload === "boolean" ? hasDownload : null;
        const searchValue = searchInput !== null && searchInput !== void 0 ? searchInput : "";
        const session = driver.session();
        let titleRegex = `(?i).*${searchValue}.*`;
        let bodyRegex = `(?i).*${searchValue}.*`;
        try {
            let aggregateCount = 0;
            const queryParams = {
                searchInput: searchValue,
                showArchived,
                showUnanswered: showUnanswered !== null && showUnanswered !== void 0 ? showUnanswered : false,
                hasDownload: hasDownloadFilter,
                titleRegex,
                bodyRegex,
                selectedTags: selectedTags || [],
                labelFilters: labelFilters || [],
                channelUniqueName,
                offset: parseInt(offset, 10),
                limit: parseInt(limit, 10),
                startOfTimeFrame: null,
                sortOption: "new",
                loggedInUsername
            };
            switch (sort) {
                case "new":
                    const newDiscussionChannelsResult = await session.run(getDiscussionChannelsQuery, queryParams);
                    const newDiscussionChannels = newDiscussionChannelsResult.records.map((record) => {
                        return record.get("DiscussionChannel");
                    });
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
                    const topDiscussionChannelsResult = await session.run(getDiscussionChannelsQuery, {
                        ...queryParams,
                        startOfTimeFrame: selectedTimeFrame,
                        sortOption: "top"
                    });
                    const topDiscussionChannels = topDiscussionChannelsResult.records.map((record) => {
                        return record.get("DiscussionChannel");
                    });
                    const firstTopResult = topDiscussionChannelsResult.records[0];
                    if (firstTopResult) {
                        aggregateCount = firstTopResult.get("totalCount");
                    }
                    return {
                        discussionChannels: topDiscussionChannels,
                        aggregateDiscussionChannelsCount: aggregateCount,
                    };
                default:
                    const hotDiscussionChannelsResult = await session.run(getDiscussionChannelsQuery, {
                        ...queryParams,
                        sortOption: "hot"
                    });
                    const hotDiscussionChannels = hotDiscussionChannelsResult.records.map((record) => {
                        return record.get("DiscussionChannel");
                    });
                    const firstHotResult = hotDiscussionChannelsResult.records[0];
                    if (firstHotResult) {
                        aggregateCount = firstHotResult.get("totalCount");
                    }
                    return {
                        discussionChannels: hotDiscussionChannels,
                        aggregateDiscussionChannelsCount: aggregateCount,
                    };
            }
        }
        catch (error) {
            console.error("Error getting discussionChannels:", error);
            throw new Error(`Failed to fetch discussionChannels in channel. ${error.message}`);
        }
        finally {
            session.close();
        }
    };
};
export default getResolver;
