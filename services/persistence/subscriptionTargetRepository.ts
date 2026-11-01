import { scalars } from "@neo4j/graphql";
import { GraphQLBoolean, GraphQLID, GraphQLInt, GraphQLString, type GraphQLScalarType } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

type Subscribers = { username: string }[];
type TargetIdentity = { id: string; createdAt: string };
export type CommentSubscriptionTarget = TargetIdentity & { text: string | null; SubscribedToNotifications: Subscribers };
export type DiscussionChannelSubscriptionTarget = TargetIdentity & { discussionId: string; channelUniqueName: string; archived: boolean | null; SubscribedToNotifications: Subscribers };
export type EventSubscriptionTarget = TargetIdentity & { title: string; description: string | null; SubscribedToNotifications: Subscribers };
export type EventUpdatesSubscriptionTarget = TargetIdentity & { title: string; SubscribedToEventUpdates: Subscribers };
export type IssueSubscriptionTarget = TargetIdentity & { issueNumber: number; title: string | null; channelUniqueName: string | null; SubscribedToNotifications: Subscribers };

export interface SubscriptionTargetRepository {
  findComment(id: string): Promise<CommentSubscriptionTarget[]>;
  findDiscussionChannel(id: string): Promise<DiscussionChannelSubscriptionTarget[]>;
  findEvent(id: string): Promise<EventSubscriptionTarget[]>;
  findEventUpdates(id: string): Promise<EventUpdatesSubscriptionTarget[]>;
  findIssue(id: string): Promise<IssueSubscriptionTarget[]>;
}

type Projection = readonly [string, GraphQLScalarType, boolean];
const id: Projection = ["id", GraphQLID, true];
const createdAt: Projection = ["createdAt", scalars.GraphQLDateTime, true];
const projections = {
  Comment: [id, ["text", GraphQLString, false], createdAt],
  DiscussionChannel: [id, ["discussionId", GraphQLID, true], ["channelUniqueName", GraphQLString, true], createdAt, ["archived", GraphQLBoolean, false]],
  Event: [id, ["title", GraphQLString, true], ["description", GraphQLString, false], createdAt],
  EventUpdates: [id, ["title", GraphQLString, true], createdAt],
  Issue: [id, ["issueNumber", GraphQLInt, true], ["title", GraphQLString, false], ["channelUniqueName", GraphQLString, false], createdAt],
} satisfies Record<string, Projection[]>;

// These are fixed projections for the five subscription responses, not a model
// API. The generated schema applies its default 25-item limits at both levels.
export const SUBSCRIPTION_TARGET_QUERIES = Object.fromEntries(
  Object.entries(projections).map(([kind, fields]) => {
    const label = kind === "EventUpdates" ? "Event" : kind;
    const relation = kind === "Issue" ? "SUBSCRIBED_TO_ISSUE" :
      kind === "EventUpdates" ? "SUBSCRIBED_TO_EVENT_UPDATES" : "SUBSCRIBED_TO_NOTIFICATIONS";
    const visibility = label === "Event" ? "" :
      "WHERE target.ageGateRestricted IS NULL OR target.ageGateRestricted = false";
    return [kind, `
      MATCH (target:${label} {id: $id})
      ${visibility}
      RETURN target { ${fields.map(([name]) => name === "createdAt"
          ? "createdAt: apoc.date.convertFormat(toString(target.createdAt), 'iso_zoned_date_time', 'iso_offset_date_time')"
          : `.${name}`).join(", ")},
        subscribers: [(target)<-[:${relation}]-(subscriber:User) | subscriber { .username }][..25]
      } AS target
      LIMIT 25
    `];
  })
) as Record<keyof typeof projections, string>;

function serialize<Internal, External>(value: unknown, scalar: GraphQLScalarType<Internal, External>, required: true, path: string): External;
function serialize<Internal, External>(value: unknown, scalar: GraphQLScalarType<Internal, External>, required: false, path: string): External | null;
function serialize(value: unknown, scalar: GraphQLScalarType, required: boolean, path: string): unknown {
  if (value == null) {
    if (required) throw new Error(`Cannot return null for non-nullable field ${path}.`);
    return null;
  }
  const convertId = (entry: unknown) => neo4j.isInt(entry) ? entry.toNumber() :
    typeof entry === "number" ? entry.toString(10) : entry;
  const convertInt = (entry: unknown) => entry &&
    (["number", "string", "bigint"].includes(typeof entry) || neo4j.isInt(entry))
    ? neo4j.integer.toNumber(entry as Parameters<typeof neo4j.integer.toNumber>[0]) : entry;
  // Match generated ID/numerical field resolvers before scalar coercion,
  // including malformed array properties and truthy numeric strings/floats.
  if (scalar === GraphQLID || scalar === GraphQLInt) {
    const convert = scalar === GraphQLID ? convertId : convertInt;
    return scalar.serialize(Array.isArray(value) ? value.map(convert) : convert(value));
  }
  return scalar.serialize(value);
}

// The fixed Cypher map owns this raw shape. Scalar output types come from the
// scalar's declared serializer, not an assertion that a partial map is an entity.
function subscribers(raw: Record<string, unknown>): Subscribers {
  const values = raw.subscribers as { username: unknown }[];
  return values.map(value => ({ username: serialize(value.username, GraphQLString, true, "User.username") }));
}
function decodeComment(raw: Record<string, unknown>): CommentSubscriptionTarget {
  return {
    id: serialize(raw.id, GraphQLID, true, "Comment.id"),
    text: serialize(raw.text, GraphQLString, false, "Comment.text"),
    createdAt: serialize(raw.createdAt, scalars.GraphQLDateTime, true, "Comment.createdAt"),
    SubscribedToNotifications: subscribers(raw),
  };
}
function decodeDiscussionChannel(raw: Record<string, unknown>): DiscussionChannelSubscriptionTarget {
  return {
    id: serialize(raw.id, GraphQLID, true, "DiscussionChannel.id"),
    discussionId: serialize(raw.discussionId, GraphQLID, true, "DiscussionChannel.discussionId"),
    channelUniqueName: serialize(raw.channelUniqueName, GraphQLString, true, "DiscussionChannel.channelUniqueName"),
    createdAt: serialize(raw.createdAt, scalars.GraphQLDateTime, true, "DiscussionChannel.createdAt"),
    archived: serialize(raw.archived, GraphQLBoolean, false, "DiscussionChannel.archived"),
    SubscribedToNotifications: subscribers(raw),
  };
}
function decodeEvent(raw: Record<string, unknown>): EventSubscriptionTarget {
  return {
    id: serialize(raw.id, GraphQLID, true, "Event.id"),
    title: serialize(raw.title, GraphQLString, true, "Event.title"),
    description: serialize(raw.description, GraphQLString, false, "Event.description"),
    createdAt: serialize(raw.createdAt, scalars.GraphQLDateTime, true, "Event.createdAt"),
    SubscribedToNotifications: subscribers(raw),
  };
}
function decodeEventUpdates(raw: Record<string, unknown>): EventUpdatesSubscriptionTarget {
  return {
    id: serialize(raw.id, GraphQLID, true, "Event.id"),
    title: serialize(raw.title, GraphQLString, true, "Event.title"),
    createdAt: serialize(raw.createdAt, scalars.GraphQLDateTime, true, "Event.createdAt"),
    SubscribedToEventUpdates: subscribers(raw),
  };
}
function decodeIssue(raw: Record<string, unknown>): IssueSubscriptionTarget {
  return {
    id: serialize(raw.id, GraphQLID, true, "Issue.id"),
    issueNumber: serialize(raw.issueNumber, GraphQLInt, true, "Issue.issueNumber"),
    title: serialize(raw.title, GraphQLString, false, "Issue.title"),
    channelUniqueName: serialize(raw.channelUniqueName, GraphQLString, false, "Issue.channelUniqueName"),
    createdAt: serialize(raw.createdAt, scalars.GraphQLDateTime, true, "Issue.createdAt"),
    SubscribedToNotifications: subscribers(raw),
  };
}

export function createSubscriptionTargetRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): SubscriptionTargetRepository {
  const read = async <Target>(kind: keyof typeof projections, targetId: string, decode: (raw: Record<string, unknown>) => Target): Promise<Target[]> => {
    const session = driver.session({ database, defaultAccessMode: neo4j.session.READ,
      bookmarkManager: driver.executeQueryBookmarkManager });
    try {
      const result = await session.executeRead(tx => tx.run(SUBSCRIPTION_TARGET_QUERIES[kind], { id: targetId }));
      // Decode every selected root before the caller chooses [0], preserving
      // first-error ordering and validation of duplicate roots.
      return result.records.map(record => decode(record.get("target")));
    } finally {
      await session.close();
    }
  };
  return {
    findComment: id => read("Comment", id, decodeComment),
    findDiscussionChannel: id => read("DiscussionChannel", id, decodeDiscussionChannel),
    findEvent: id => read("Event", id, decodeEvent),
    findEventUpdates: id => read("EventUpdates", id, decodeEventUpdates),
    findIssue: id => read("Issue", id, decodeIssue),
  };
}
