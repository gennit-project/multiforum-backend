import { getSiteWideDiscussionsQuery } from "../cypher/cypherQueries.js";
import { timeFrameOptions } from "./utils.js";
var timeFrameOptionKeys;
(function (timeFrameOptionKeys) {
    timeFrameOptionKeys["year"] = "year";
    timeFrameOptionKeys["month"] = "month";
    timeFrameOptionKeys["week"] = "week";
    timeFrameOptionKeys["day"] = "day";
})(timeFrameOptionKeys || (timeFrameOptionKeys = {}));
const getResolver = (input) => {
    const { driver, Discussion } = input;
    return async (parent, args, context, info) => {
        const { searchInput, selectedChannels, selectedTags, showArchived, hasDownload, loggedInUsername, options } = args;
        const { offset, limit, resultsOrder, sort, timeFrame } = options || {};
        const session = driver.session();
        let titleRegex = `(?i).*${searchInput}.*`;
        let bodyRegex = `(?i).*${searchInput}.*`;
        let totalCount = 0;
        try {
            switch (sort) {
                case "new":
                    let newDiscussionResult = await session.run(getSiteWideDiscussionsQuery, {
                        searchInput,
                        titleRegex,
                        bodyRegex,
                        selectedChannels,
                        selectedTags,
                        showArchived,
                        hasDownload,
                        offset,
                        limit,
                        resultsOrder,
                        startOfTimeFrame: null,
                        sortOption: "new",
                        loggedInUsername: loggedInUsername || null,
                    });
                    // For each record, do record.get("discussion") to get the discussions
                    let newRecord = newDiscussionResult.records[0]; // Assuming there's only one result row
                    if (newRecord) {
                        totalCount = newRecord.get("totalCount");
                    }
                    let discussions = newDiscussionResult.records.map((record) => {
                        return record.get("discussion");
                    });
                    return {
                        discussions,
                        aggregateDiscussionCount: totalCount,
                    };
                case "top":
                    // if sort is "top", get the Discussions sorted by the sum of the
                    // weightedVotesCounts of the related DiscussionChannels.
                    // Treat a null weightedVotesCount as 0.
                    let selectedTimeFrame = timeFrameOptions.year.start;
                    if (timeFrameOptions[timeFrame]) {
                        selectedTimeFrame = timeFrameOptions[timeFrame].start;
                    }
                    let topDiscussionsResult = await session.run(getSiteWideDiscussionsQuery, {
                        searchInput,
                        titleRegex,
                        bodyRegex,
                        selectedChannels,
                        selectedTags,
                        showArchived,
                        hasDownload,
                        offset,
                        limit,
                        resultsOrder,
                        startOfTimeFrame: selectedTimeFrame,
                        sortOption: "top",
                        loggedInUsername: loggedInUsername || null,
                    });
                    // Extract the total count and the discussions from the query result
                    let topRecord = topDiscussionsResult.records[0]; // Assuming there's only one result row
                    if (topRecord) {
                        totalCount = topRecord.get("totalCount");
                    }
                    let topDiscussions = topDiscussionsResult.records.map((record) => {
                        return record.get("discussion");
                    });
                    return {
                        discussions: topDiscussions,
                        aggregateDiscussionCount: totalCount,
                    };
                default:
                    // By default, and if sort is "hot", get the DiscussionChannels sorted by hot,
                    // which takes into account both weightedVotesCount and createdAt.
                    let hotDiscussionsResult = await session.run(getSiteWideDiscussionsQuery, {
                        searchInput,
                        titleRegex,
                        bodyRegex,
                        selectedChannels,
                        selectedTags,
                        showArchived,
                        hasDownload,
                        offset,
                        limit,
                        resultsOrder,
                        startOfTimeFrame: null,
                        sortOption: "hot",
                        loggedInUsername: loggedInUsername || null,
                    });
                    // Extract the total count and the discussions from the query result
                    let hotRecord = hotDiscussionsResult.records[0]; // Assuming there's only one result row
                    if (hotRecord) {
                        totalCount = hotRecord.get("totalCount");
                    }
                    let hotDiscussions = hotDiscussionsResult.records.map((record) => {
                        return record.get("discussion");
                    });
                    return {
                        discussions: hotDiscussions,
                        aggregateDiscussionCount: totalCount,
                    };
            }
        }
        catch (error) {
            console.error("Error getting discussions:", error);
            throw new Error(`Failed to fetch discussions. ${error.message}`);
        }
        finally {
            session.close();
        }
    };
};
export default getResolver;
