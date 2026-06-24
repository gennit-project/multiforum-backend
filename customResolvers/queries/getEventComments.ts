import type { GraphQLResolveInfo } from "graphql";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import {
    getEventCommentsQuery,
  }from "../cypher/cypherQueries.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { populateCommentSubscriptionStatus } from "./commentSubscriptionStatus.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventModel } from "../../ogm_types.js";

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
  Event: EventModel;
  driver: Driver;
};

type Args = {
  eventId: string;
  offset: string;
  limit: string;
  sort: string;
};

const getResolver = (input: Input) => {
  const { driver, Event } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
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

      let comments = commentsResult.records.map((record: Neo4jRecord) => {
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
    } catch (error: unknown) {
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
