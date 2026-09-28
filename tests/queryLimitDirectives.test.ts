import assert from "node:assert/strict";
import test from "node:test";
import { Kind, type ObjectTypeDefinitionNode } from "graphql";
import typeDefs from "../typeDefs.js";

const HIGH_CARDINALITY_TYPES = [
  "Channel",
  "Comment",
  "Discussion",
  "DiscussionChannel",
  "DownloadableFile",
  "Event",
  "EventChannel",
  "EventSeries",
  "Image",
  "Issue",
  "ModerationAction",
  "Notification",
  "TextVersion",
  "User",
  "WikiPage",
];

test("high-cardinality node types have default and maximum list limits", () => {
  const objectTypes = new Map(
    typeDefs.definitions
      .filter(
        (definition): definition is ObjectTypeDefinitionNode =>
          definition.kind === Kind.OBJECT_TYPE_DEFINITION
      )
      .map((definition) => [definition.name.value, definition])
  );

  for (const typeName of HIGH_CARDINALITY_TYPES) {
    const definition = objectTypes.get(typeName);
    assert.ok(definition, `${typeName} must be defined`);
    const directive = definition.directives?.find(
      (candidate) => candidate.name.value === "limit"
    );
    assert.ok(directive, `${typeName} must declare @limit`);

    const values = Object.fromEntries(
      (directive.arguments ?? []).map((argument) => [
        argument.name.value,
        argument.value.kind === Kind.INT ? Number(argument.value.value) : undefined,
      ])
    );
    assert.deepEqual(values, { default: 25, max: 100 });
  }
});
