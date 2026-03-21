import { getEventCommentsQuery, } from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { populateCommentSubscriptionStatus } from "./commentSubscriptionStatus.js";
const eventSelectionSet = `
  {
    id
    title
    description
    startTime
    endTime
    locationName
    address
    virtualEventUrl
    startTimeDayOfWeek
    startTimeHourOfDay
    canceled
    isHostedByOP
    isAllDay
    coverImageURL
    createdAt
    updatedAt
    placeId
    isInPrivateResidence
    cost
  }
  `;
const getResolver = (input) => {
    const { driver, Event } = input;
    return async (parent, args, context, info) => {
        var _a;
        const { eventId, offset, limit, sort } = args;
        context.user = await setUserDataOnContext({
            context,
            getPermissionInfo: false,
        });
        const loggedInUsername = ((_a = context.user) === null || _a === void 0 ? void 0 : _a.username) || null;
        const session = driver.session();
        try {
            const result = await Event.find({
                where: {
                    id: eventId,
                },
                // get everything about the Event
                // except the comments
                selectionSet: eventSelectionSet,
            });
            if (result.length === 0) {
                throw new Error("Event not found");
            }
            const event = result[0];
            const commentsResult = await session.run(getEventCommentsQuery, {
                eventId,
                offset: parseInt(offset, 10),
                limit: parseInt(limit, 10),
                sortOption: sort === "top" ? "top" : sort === "hot" ? "hot" : "new",
                loggedInUsername,
            });
            let comments = commentsResult.records.map((record) => {
                return record.get("comment");
            });
            comments = await populateCommentSubscriptionStatus({
                comments,
                loggedInUsername,
                session,
            });
            return {
                Event: event,
                Comments: comments,
            };
        }
        catch (error) {
            console.error("Error getting comment section:", error);
            return {
                Event: null,
                Comments: []
            };
        }
        finally {
            session.close();
        }
    };
};
export default getResolver;
