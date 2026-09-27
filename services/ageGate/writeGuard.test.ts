import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { Kind, type DocumentNode, type GraphQLSchema, type TypeNode } from "graphql";
import typeDefinitions from "../../typeDefs.js";
import { getAgeGateStatements, DERIVED_AGE_GATE_TYPES } from "./definitions.js";
import {
  EXEMPT_RELATIONSHIP_FIELDS,
  GUARDED_RELATIONSHIP_FIELDS,
  findUnsafeAgeGateWrites,
  relationshipTypesInStatement,
} from "./writeGuard.js";

let schema: GraphQLSchema;

before(async () => {
  schema = await new Neo4jGraphQL({ typeDefs: typeDefinitions }).getSchema();
}, { timeout: 120000 });

// Types whose age-gate result can depend on one another.
const AGE_GATED_TYPES = new Set<string>(["Discussion", ...DERIVED_AGE_GATE_TYPES]);

type RelationshipField = { field: string; relationship: string; target: string };

const namedType = (type: TypeNode): string =>
  type.kind === Kind.NAMED_TYPE ? type.name.value : namedType(type.type);

const relationshipFields = (): RelationshipField[] =>
  (typeDefinitions as DocumentNode).definitions.flatMap((definition) => {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) return [];
    return (definition.fields ?? []).flatMap((field) => {
      const directive = field.directives?.find((d) => d.name.value === "relationship");
      const typeArgument = directive?.arguments?.find((a) => a.name.value === "type");
      if (typeArgument?.value.kind !== Kind.STRING) return [];
      return [
        {
          field: `${definition.name.value}.${field.name.value}`,
          relationship: typeArgument.value.value,
          target: namedType(field.type),
        },
      ];
    });
  });

const definitionRelationshipTypes = () =>
  new Set(Object.values(getAgeGateStatements(typeDefinitions)).flatMap(relationshipTypesInStatement));

const unsafe = (mutationName: string, args: Record<string, unknown>) =>
  findUnsafeAgeGateWrites({ schema, mutationName, args }).map(({ reason, field }) => `${reason} ${field}`);

const connectTo = (id: string) => ({ where: { node: { id } } });

// Coverage: CI fails if a definition starts following a relationship the
// guard doesn't cover, or a qualifying field is added without a decision.

test("the definitions follow the expected relationship types", () => {
  assert.deepEqual([...definitionRelationshipTypes()].sort(), [
    "CONTAINS_COMMENT",
    "HAS_BODY_VERSION",
    "HAS_DOWNLOADABLE_FILE",
    "HAS_FEEDBACK_COMMENT",
    "HAS_TITLE_VERSION",
    "HAS_VERSION",
    "IS_REPLY_TO",
    "POSTED_IN_CHANNEL",
  ]);
});

test("every relationship type an age-gate definition follows has a guarded field", () => {
  const byField = new Map(relationshipFields().map((f) => [f.field, f.relationship]));
  const guardedTypes = new Set(GUARDED_RELATIONSHIP_FIELDS.map((field) => byField.get(field)));
  assert.deepEqual(
    [...definitionRelationshipTypes()].filter((type) => !guardedTypes.has(type)),
    []
  );
});

test("every field on a followed relationship between age-gated types is guarded or exempt", () => {
  const followed = definitionRelationshipTypes();
  const decided = new Set<string>([
    ...GUARDED_RELATIONSHIP_FIELDS,
    ...Object.keys(EXEMPT_RELATIONSHIP_FIELDS),
  ]);
  const undecided = relationshipFields()
    .filter(
      ({ field, relationship, target }) =>
        followed.has(relationship) &&
        AGE_GATED_TYPES.has(field.split(".")[0] ?? "") &&
        AGE_GATED_TYPES.has(target) &&
        !decided.has(field)
    )
    .map(({ field }) => field);
  assert.deepEqual(undecided, []);
});

test("every guarded field exists in the schema", () => {
  const fields = new Set(relationshipFields().map((f) => f.field));
  assert.deepEqual(
    GUARDED_RELATIONSHIP_FIELDS.filter((field) => !fields.has(field)),
    []
  );
});

// Relationship moves.

test("connecting an existing reply to a different parent is flagged", () => {
  assert.deepEqual(
    unsafe("updateComments", {
      where: { id: "reply" },
      update: { ParentComment: { connect: connectTo("sensitive-root") } },
    }),
    ["relationship-move Comment.ParentComment"]
  );
});

test("the top-level connect argument is flagged", () => {
  assert.deepEqual(
    unsafe("updateComments", {
      where: { id: "reply" },
      connect: { ParentComment: connectTo("sensitive-root") },
    }),
    ["relationship-move Comment.ParentComment"]
  );
});

test("a move nested inside another update is flagged", () => {
  assert.deepEqual(
    unsafe("updateDiscussions", {
      where: { id: "d" },
      update: {
        DiscussionChannels: [
          { update: { node: { Comments: [{ connect: [connectTo("c")] }] } } },
        ],
      },
    }),
    ["relationship-move DiscussionChannel.Comments"]
  );
});

test("connecting an existing node's own relationships inside a connect is flagged", () => {
  assert.deepEqual(
    unsafe("createComments", {
      input: [
        {
          text: "new",
          ParentComment: {
            connect: { where: { node: { id: "p" } }, connect: { ChildComments: [connectTo("other")] } },
          },
        },
      ],
    }),
    ["relationship-move Comment.ChildComments"]
  );
});

test("creating a reply connected to its parent is allowed", () => {
  assert.deepEqual(
    unsafe("createComments", {
      input: [{ text: "new reply", ParentComment: { connect: connectTo("root") } }],
    }),
    []
  );
});

test("disconnecting is allowed, since it can only over-restrict", () => {
  assert.deepEqual(
    unsafe("updateComments", {
      where: { id: "reply" },
      update: { ParentComment: { disconnect: { where: { node: { id: "root" } } } } },
    }),
    []
  );
});

test("marking an accepted answer is allowed", () => {
  assert.deepEqual(
    unsafe("updateDiscussionChannels", {
      where: { id: "dc" },
      update: { Answers: [{ connect: [connectTo("c")] }] },
    }),
    []
  );
});

test("attaching files through updateDiscussionWithChannelConnections is allowed", () => {
  assert.deepEqual(
    unsafe("updateDiscussionWithChannelConnections", {
      where: { id: "d" },
      discussionUpdateInput: { DownloadableFiles: [{ connect: [connectTo("f")] }] },
    }),
    []
  );
});

test("attaching files through updateDiscussions is flagged", () => {
  assert.deepEqual(
    unsafe("updateDiscussions", {
      where: { id: "d" },
      update: { DownloadableFiles: [{ connect: [connectTo("f")] }] },
    }),
    ["relationship-move Discussion.DownloadableFiles"]
  );
});

// Sensitivity writes.

test("marking a discussion sensitive through updateDiscussions is allowed", () => {
  assert.deepEqual(
    unsafe("updateDiscussions", { where: { id: "d" }, update: { hasSensitiveContent: true } }),
    []
  );
});

test("an immutable connector endpoint is absent before the write guard runs", () => {
  assert.deepEqual(
    unsafe("updateDiscussionChannels", {
      where: { id: "dc" },
      update: { Discussion: { update: { node: { hasSensitiveContent: true } } } },
    }),
    []
  );
});

test("filtering on hasSensitiveContent is not a write", () => {
  assert.deepEqual(
    unsafe("updateDiscussionChannels", {
      where: { Discussion: { hasSensitiveContent: true } },
      update: { archived: true },
    }),
    []
  );
});

test("unknown mutations report nothing", () => {
  assert.deepEqual(unsafe("notARealMutation", {}), []);
});
