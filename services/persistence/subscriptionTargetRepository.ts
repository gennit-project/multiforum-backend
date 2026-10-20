import { scalars } from "@neo4j/graphql";
import { GraphQLBoolean, GraphQLID, GraphQLInt, GraphQLString, type GraphQLScalarType } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type SubscriptionTarget = {
  id: string;
  createdAt: string;
  text?: string | null;
  title?: string | null;
  description?: string | null;
  discussionId?: string;
  channelUniqueName?: string | null;
  archived?: boolean | null;
  issueNumber?: number | null;
  SubscribedToNotifications?: { username: string }[];
  SubscribedToEventUpdates?: { username: string }[];
};

export interface SubscriptionTargetRepository {
  findComment(id: string): Promise<SubscriptionTarget[]>;
  findDiscussionChannel(id: string): Promise<SubscriptionTarget[]>;
  findEvent(id: string): Promise<SubscriptionTarget[]>;
  findEventUpdates(id: string): Promise<SubscriptionTarget[]>;
  findIssue(id: string): Promise<SubscriptionTarget[]>;
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

export function createSubscriptionTargetRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): SubscriptionTargetRepository {
  const read = async (kind: keyof typeof projections, targetId: string): Promise<SubscriptionTarget[]> => {
    const session = driver.session({ database, defaultAccessMode: neo4j.session.READ,
      bookmarkManager: driver.executeQueryBookmarkManager });
    try {
      const result = await session.executeRead(tx => tx.run(SUBSCRIPTION_TARGET_QUERIES[kind], { id: targetId }));
      const label = kind === "EventUpdates" ? "Event" : kind;
      // Serialize every selected root, as GraphQL did before the caller chose [0].
      return result.records.map(record => {
        const raw = record.get("target") as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        for (const [field, scalar, required] of projections[kind]) {
          output[field] = serialize(raw[field], scalar, required, `${label}.${field}`);
        }
        const subscribers = raw.subscribers as { username: unknown }[];
        output[kind === "EventUpdates" ? "SubscribedToEventUpdates" : "SubscribedToNotifications"] =
          subscribers.map(subscriber => ({ username: serialize(subscriber.username, GraphQLString, true, "User.username") }));
        return output as SubscriptionTarget;
      });
    } finally {
      await session.close();
    }
  };
  return {
    findComment: id => read("Comment", id),
    findDiscussionChannel: id => read("DiscussionChannel", id),
    findEvent: id => read("Event", id),
    findEventUpdates: id => read("EventUpdates", id),
    findIssue: id => read("Issue", id),
  };
}
