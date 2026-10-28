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
  assert.ok(!fieldsFor(schema, "ChannelCreateInput").includes("WikiHomePage"));
  // v7 removed to-one connect/disconnect from update inputs, so WikiHomePage
  // (a to-one relationship marked @settable(onUpdate: true)) is no longer
  // exposed on ChannelUpdateInput. Changing a channel's wiki home page would
  // now require an owned write; none exists yet and nothing sets it today
  // (the frontend only reads WikiHomePage) — tracked as a v7 follow-up.
  assert.ok(!fieldsFor(schema, "ChannelUpdateInput").includes("WikiHomePage"));

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

  const wikiCreateFields = fieldsFor(schema, "WikiPageCreateInput");
  const wikiUpdateFields = fieldsFor(schema, "WikiPageUpdateInput");
  for (const field of ["slug", "channelUniqueName"]) {
    assert.ok(wikiCreateFields.includes(field), `WikiPage.${field} should be settable on create`);
    assert.ok(!wikiUpdateFields.includes(field), `WikiPage.${field} should be immutable`);
  }
  // v7: WikiPage.Channel uses nestedOperations:[CONNECT] only, and v7 removed the
  // to-one connect from create inputs (with no create op either), so Channel is
  // exposed on neither the create nor the update input. The owning-channel edge
  // is wired by the owned write (wikiPageOwnershipMiddleware), not a generated connect.
  assert.ok(!wikiCreateFields.includes("Channel"), "WikiPage.Channel is owned, not a generated create connect");
  assert.ok(!wikiUpdateFields.includes("Channel"), "WikiPage.Channel is immutable after creation");
  assert.ok(
    !fieldsFor(schema, "WikiPageDeleteInput").includes("Channel"),
    "deleting a wiki page must not offer a nested delete of its owning channel"
  );

  for (const typeName of ["ChannelRole", "ModChannelRole"]) {
    const createFields = fieldsFor(schema, `${typeName}CreateInput`);
    const updateFields = fieldsFor(schema, `${typeName}UpdateInput`);
    for (const field of ["name", "channelUniqueName"]) {
      assert.ok(createFields.includes(field), `${typeName}.${field} should be settable on create`);
      assert.ok(!updateFields.includes(field), `${typeName}.${field} should be immutable`);
    }
    assert.ok(createFields.includes("Owner"), `${typeName}.Owner should be explicit on create`);
  }

  const issueCreateFields = fieldsFor(schema, "IssueCreateInput");
  const issueUpdateFields = fieldsFor(schema, "IssueUpdateInput");
  // Scalar identity columns: settable on create, immutable on update.
  for (const field of [
    "issueNumber", "channelUniqueName", "authorName",
    "relatedDiscussionId", "relatedCommentId", "relatedEventId", "relatedWikiPageId",
    "relatedWikiRevisionId", "relatedImageId", "relatedAlbumId", "relatedUsername",
    "relatedModProfileName", "relatedProfilePicUserId", "relatedChannelUniqueName",
    "relatedChannelIconName", "relatedChannelBannerName",
  ]) {
    assert.ok(issueCreateFields.includes(field), `Issue.${field} should be settable on create`);
    assert.ok(!issueUpdateFields.includes(field), `Issue.${field} should be immutable`);
  }
  // v7: Issue's to-one relationships use nestedOperations:[CONNECT], and v7
  // removed the to-one connect from create/update inputs, so these appear on
  // neither — the edges are owned by createIssue / issueIdentityMiddleware, and
  // the scalar related*Id columns above carry the identity.
  for (const field of [
    "Channel", "Author", "TargetDiscussion", "TargetComment", "TargetEvent",
    "TargetWikiPage", "TargetWikiRevision", "TargetImage", "TargetAlbum", "TargetUser",
    "TargetModProfile", "TargetProfilePictureUser", "TargetChannel",
  ]) {
    assert.ok(!issueCreateFields.includes(field), `Issue.${field} is owned, not a generated create connect`);
    assert.ok(!issueUpdateFields.includes(field), `Issue.${field} should be immutable`);
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
    `mutation { updateWikiPages(update: { slug: "renamed" }) { wikiPages { id } } }`,
    `mutation { updateWikiPages(update: { channelUniqueName: "other" }) { wikiPages { id } } }`,
    `mutation { updateWikiPages(update: { Channel: { disconnect: {} } }) { wikiPages { id } } }`,
    `mutation { updateChannelRoles(update: { name: "renamed" }) { channelRoles { id } } }`,
    `mutation { updateChannelRoles(update: { channelUniqueName: "other" }) { channelRoles { id } } }`,
    `mutation { updateModChannelRoles(update: { name: "renamed" }) { modChannelRoles { id } } }`,
    `mutation { updateModChannelRoles(update: { channelUniqueName: "other" }) { modChannelRoles { id } } }`,
    `mutation { updateIssues(update: { relatedDiscussionId: "other" }) { issues { id } } }`,
    `mutation { updateIssues(update: { TargetDiscussion: { connect: { where: { node: { id: "other" } } } } }) { issues { id } } }`,
  ];

  for (const mutation of attempts) {
    const errors = validate(schema, parse(mutation));
    assert.ok(errors.length > 0, `expected validation failure for ${mutation}`);
  }
});
