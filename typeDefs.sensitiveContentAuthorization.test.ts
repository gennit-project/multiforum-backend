import test from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { isInputObjectType, isObjectType } from "graphql";
import typeDefs from "./typeDefs.js";

const protectedTypes = [
  "Discussion",
  "DiscussionChannel",
  "Comment",
  "Image",
  "Issue",
  "TextVersion",
  "DownloadableFile",
  "FileVersion",
];

test("sensitive-content policy fields are hidden but available to authorization filters", async () => {
  const schema = await new Neo4jGraphQL({
    typeDefs,
    features: { subscriptions: true },
  }).getSchema();

  for (const typeName of protectedTypes) {
    const output = schema.getType(typeName);
    assert.ok(isObjectType(output), `${typeName} should be an object`);
    assert.equal(
      output.getFields().ageGateSensitive,
      undefined,
      `${typeName} leaked its internal policy field`
    );

    const where = schema.getType(`${typeName}Where`);
    assert.ok(isInputObjectType(where), `${typeName}Where should be an input object`);
    assert.ok(
      where.getFields().ageGateSensitive,
      `${typeName}Where must expose the internal field to its authorization rule`
    );
  }
});

test("protected types use eligibility-only subscription guards", () => {
  for (const typeName of protectedTypes) {
    const definition = typeDefs.definitions.find(
      (candidate) =>
        candidate.kind === "ObjectTypeDefinition" && candidate.name.value === typeName
    );
    assert.ok(definition && definition.kind === "ObjectTypeDefinition");
    assert.ok(
      definition.directives?.some(
        (directive) => directive.name.value === "subscriptionsAuthorization"
      ),
      `${typeName} needs a subscription authorization rule`
    );
  }
});
