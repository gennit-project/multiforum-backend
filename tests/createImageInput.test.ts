import assert from "node:assert/strict";
import test from "node:test";
import { Kind, type DocumentNode } from "graphql";
import typeDefinitions from "../typeDefs.js";

const inputFields = (document: DocumentNode, name: string): string[] => {
  const definition = document.definitions.find(
    (d) => d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && d.name.value === name
  );
  assert.ok(definition && definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION);
  return (definition.fields ?? []).map((field) => field.name.value);
};

// The frontend sends storageObjectName on every album image it creates
// (graphQLData/discussion/mutations.js CREATE_IMAGE), and
// createImageWithUploader uses it to claim the upload's audit metadata.
// Without it in the schema, every album image request fails validation.
test("CreateImageInput accepts storageObjectName", () => {
  assert.ok(
    inputFields(typeDefinitions as DocumentNode, "CreateImageInput").includes(
      "storageObjectName"
    )
  );
});
