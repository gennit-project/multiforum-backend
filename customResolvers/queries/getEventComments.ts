import {
    getEventCommentsQuery,
  }from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

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

type Input = {
  Event: any;
  driver: any;
};

type Args = {
  eventId: string;
  offset: string;
  limit: string;
  sort: string;
};

const getResolver = (input: Input) => {
  const { driver, Event } = input;
  return async (parent: any, args: Args, context: any, info: any) => {
    const { eventId, offset, limit, sort } = args;
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });
    const loggedInUsername = context.user?.username || null;

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

      const comments = commentsResult.records.map((record: any) => {
        return record.get("comment");
      });

      return {
        Event: event,
        Comments: comments,
      };
    } catch (error: any) {
      console.error("Error getting comment section:", error);
      return {
        Event: null,
        Comments: []
      }
    } finally {
      session.close();
    }
  };
};

export default getResolver;
