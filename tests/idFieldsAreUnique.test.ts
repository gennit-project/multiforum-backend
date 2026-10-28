import assert from "node:assert/strict";
import test from "node:test";
import { Kind, type DocumentNode } from "graphql";
import typeDefinitions from "../typeDefs.js";
import { coreSchemaConstraintStatements } from "../services/coreSchemaConstraints.js";

// `@id` only auto-generates a UUID; it does not create a uniqueness
// constraint. @neo4j/graphql 7 removed the `@unique` directive that used to
// pair with it, so uniqueness is now enforced by the single-field constraints
// created at startup (services/coreSchemaConstraints.ts). Without a matching
// constraint a fresh database gets no index on id (every lookup by id scans
// the label) and nothing prevents duplicate ids. Keep every @id field paired
// with a `... REQUIRE n.<field> IS UNIQUE` constraint.
const idFieldsWithoutUniqueConstraint = (
  document: DocumentNode,
  constraintStatements: readonly string[]
): string[] => {
  const missing: string[] = [];
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) continue;
    for (const field of definition.fields ?? []) {
      const directives = new Set(field.directives?.map((d) => d.name.value));
      if (!directives.has("id")) continue;
      const needle = `FOR (n:${definition.name.value}) REQUIRE n.${field.name.value} IS UNIQUE`;
      if (!constraintStatements.some((statement) => statement.includes(needle))) {
        missing.push(`${definition.name.value}.${field.name.value}`);
      }
    }
  }
  return missing;
};

test("every @id field has a single-field uniqueness constraint", () => {
  assert.deepEqual(
    idFieldsWithoutUniqueConstraint(
      typeDefinitions as DocumentNode,
      coreSchemaConstraintStatements
    ),
    []
  );
});

test("the check flags an @id field with no uniqueness constraint", () => {
  const document: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OBJECT_TYPE_DEFINITION,
        name: { kind: Kind.NAME, value: "Widget" },
        fields: [
          {
            kind: Kind.FIELD_DEFINITION,
            name: { kind: Kind.NAME, value: "id" },
            type: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: "ID" } },
            directives: [
              { kind: Kind.DIRECTIVE, name: { kind: Kind.NAME, value: "id" } },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(idFieldsWithoutUniqueConstraint(document, []), ["Widget.id"]);
});
