import assert from "node:assert/strict";
import test from "node:test";
import { Kind, type DocumentNode } from "graphql";
import typeDefinitions from "../typeDefs.js";

// Since @neo4j/graphql 4, `@id` only auto-generates a UUID; it no longer
// creates a uniqueness constraint. Without `@unique`, a fresh database gets
// no index on id (every lookup by id scans the label) and nothing prevents
// duplicate ids. Keep every @id field paired with @unique.
const idFieldsWithoutUnique = (document: DocumentNode): string[] => {
  const missing: string[] = [];
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) continue;
    for (const field of definition.fields ?? []) {
      const directives = new Set(field.directives?.map((d) => d.name.value));
      if (directives.has("id") && !directives.has("unique")) {
        missing.push(`${definition.name.value}.${field.name.value}`);
      }
    }
  }
  return missing;
};

test("every @id field is also @unique", () => {
  assert.deepEqual(idFieldsWithoutUnique(typeDefinitions as DocumentNode), []);
});

test("the check flags an @id field without @unique", () => {
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

  assert.deepEqual(idFieldsWithoutUnique(document), ["Widget.id"]);
});
