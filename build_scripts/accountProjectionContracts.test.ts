import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Kind, parse, type SelectionSetNode } from "graphql";
import { profileCollectionSelection, publicCollectionSelection, profileImageSelection, channelIconSelection } from "../customResolvers/contracts/accountProjections.js";
import { PROFILE_IMAGE_SELECTION, CHANNEL_ICON_SELECTION } from "../services/persistence/imageWriteRepository.js";
import { getPublicCollectionSelectionSet } from "../services/persistence/collectionReadRepository.js";

function shape(selection: SelectionSetNode): Record<string, unknown> {
  return Object.fromEntries(selection.selections.map(field => {
    assert.equal(field.kind, Kind.FIELD, "fixed projections must spell every selected field explicitly");
    if (field.kind !== Kind.FIELD) throw new Error("Unexpected fragment");
    return [field.name.value, field.selectionSet ? shape(field.selectionSet) : true];
  }));
}
function projection(source: string, root?: string) {
  const operation = parse(source).definitions[0];
  assert.equal(operation.kind, Kind.OPERATION_DEFINITION);
  if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error("Expected operation");
  if (!root) return shape(operation.selectionSet);
  const field = operation.selectionSet.selections.find(node => node.kind === Kind.FIELD && node.name.value === root);
  assert.ok(field?.kind === Kind.FIELD && field.selectionSet);
  return shape(field.selectionSet);
}
test("profile collection projection matches the actual fixed generated operation", () => {
  const source = readFileSync("services/persistence/collectionReadRepository.ts", "utf8");
  const document = source.match(/const PROFILE_COLLECTIONS = `([\s\S]*?)`;/)?.[1];
  assert.ok(document);
  assert.deepEqual(projection(document, "collections"), profileCollectionSelection);
});
for (const visible of [false, true]) test(`public collection projection matches visibility=${visible} generated selection`, () => {
  assert.deepEqual(projection(getPublicCollectionSelectionSet(visible)), publicCollectionSelection);
});
for (const [name, actual, expected] of [
  ["profile image", PROFILE_IMAGE_SELECTION, profileImageSelection],
  ["channel icon", CHANNEL_ICON_SELECTION, channelIconSelection],
] as const) test(`${name} projection matches generated mutation selection`, () => {
  assert.deepEqual(projection(actual), expected);
});
