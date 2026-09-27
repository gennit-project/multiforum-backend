import assert from "node:assert/strict";
import test from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { isInputObjectType, parse, validate, type GraphQLSchema } from "graphql";
import typeDefs from "./typeDefs.js";

const fieldsFor = (schema: GraphQLSchema, typeName: string): string[] => {
  const type = schema.getType(typeName);
  assert.ok(isInputObjectType(type), `${typeName} should be an input object`);
  return Object.keys(type.getFields());
};

test("channel and connector identity can be set at creation but not changed", async () => {
  const schema = await new Neo4jGraphQL({ typeDefs }).getSchema();

  assert.ok(fieldsFor(schema, "ChannelCreateInput").includes("uniqueName"));
  assert.ok(!fieldsFor(schema, "ChannelUpdateInput").includes("uniqueName"));
  assert.ok(!fieldsFor(schema, "ChannelUpdateInput").includes("createdAt"));

  for (const [typeName, identityFields] of [
    ["DiscussionChannel", ["discussionId", "channelUniqueName", "Discussion", "Channel"]],
    ["EventChannel", ["eventId", "channelUniqueName", "Event", "Channel"]],
  ] as const) {
    const createFields = fieldsFor(schema, `${typeName}CreateInput`);
    const updateFields = fieldsFor(schema, `${typeName}UpdateInput`);

    for (const field of identityFields) {
      assert.ok(createFields.includes(field), `${typeName}.${field} should be settable on create`);
      assert.ok(!updateFields.includes(field), `${typeName}.${field} should be immutable`);
    }
    assert.ok(!updateFields.includes("createdAt"), `${typeName}.createdAt should be server-owned`);
  }
});

test("GraphQL rejects attempts to rewrite immutable identities", async () => {
  const schema = await new Neo4jGraphQL({ typeDefs }).getSchema();
  const attempts = [
    `mutation { updateChannels(update: { uniqueName: "renamed" }) { channels { uniqueName } } }`,
    `mutation { updateDiscussionChannels(update: { discussionId: "other" }) { discussionChannels { id } } }`,
    `mutation { updateDiscussionChannels(update: { Discussion: { disconnect: {} } }) { discussionChannels { id } } }`,
    `mutation { updateEventChannels(update: { channelUniqueName: "other" }) { eventChannels { id } } }`,
    `mutation { updateEventChannels(update: { Channel: { disconnect: {} } }) { eventChannels { id } } }`,
  ];

  for (const mutation of attempts) {
    const errors = validate(schema, parse(mutation));
    assert.ok(errors.length > 0, `expected validation failure for ${mutation}`);
  }
});
