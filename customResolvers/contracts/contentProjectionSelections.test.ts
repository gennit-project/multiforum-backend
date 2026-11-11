import assert from "node:assert/strict";
import { test } from "node:test";
import { Kind, parse, type SelectionSetNode } from "graphql";
import {
 createdEventSelection, eventUpdateSnapshotSelection, updatedEventSelection,
 createdEventSeriesSelection, seriesOccurrenceSnapshotSelection, updatedSeriesOccurrenceSelection,
 createdDiscussionSelection, discussionUpdateSnapshotSelection, updatedDiscussionSelection,
} from "./contentProjections.js";
import { CREATED_EVENT_SELECTION, EVENT_UPDATE_SNAPSHOT_SELECTION, UPDATED_EVENT_SELECTION } from "../../services/persistence/eventWriteRepository.js";
import { CREATED_EVENT_SERIES_SELECTION } from "../../services/persistence/eventSeriesCreationRepository.js";
import { SERIES_OCCURRENCE_SNAPSHOT_SELECTION, UPDATED_SERIES_OCCURRENCE_SELECTION } from "../../services/persistence/eventSeriesUpdateRepository.js";
import { DISCUSSION_CREATE_SELECTION } from "../../services/persistence/discussionCreationRepository.js";
import { DISCUSSION_UPDATE_SNAPSHOT_SELECTION, UPDATED_DISCUSSION_SELECTION } from "../../services/persistence/discussionUpdateRepository.js";

type FieldSelection = { [field: string]: true | FieldSelection };
function selectedFields(set: SelectionSetNode): FieldSelection {
 return Object.fromEntries(set.selections.map(field => {
  assert.equal(field.kind,Kind.FIELD);
  if(field.kind !== Kind.FIELD) throw new Error("Only fixed field selections are expected");
  assert.equal(field.alias,undefined);
  return [field.name.value,field.selectionSet ? selectedFields(field.selectionSet) : true];
 }));
}
for(const [name,source,selection] of [
 ["created event",CREATED_EVENT_SELECTION,createdEventSelection],
 ["event update snapshot",EVENT_UPDATE_SNAPSHOT_SELECTION,eventUpdateSnapshotSelection],
 ["updated event",UPDATED_EVENT_SELECTION,updatedEventSelection],
 ["created series",CREATED_EVENT_SERIES_SELECTION,createdEventSeriesSelection],
 ["series occurrence snapshot",SERIES_OCCURRENCE_SNAPSHOT_SELECTION,seriesOccurrenceSnapshotSelection],
 ["updated series occurrence",UPDATED_SERIES_OCCURRENCE_SELECTION,updatedSeriesOccurrenceSelection],
 ["created discussion",DISCUSSION_CREATE_SELECTION,createdDiscussionSelection],
 ["discussion update snapshot",DISCUSSION_UPDATE_SNAPSHOT_SELECTION,discussionUpdateSnapshotSelection],
 ["updated discussion",UPDATED_DISCUSSION_SELECTION,updatedDiscussionSelection],
] as const) {
 test(`${name}: precise result type selection mirrors the actual generated-operation projection`,()=>{
  const operation=parse(source).definitions[0];
  assert.equal(operation.kind,Kind.OPERATION_DEFINITION);
  if(operation.kind !== Kind.OPERATION_DEFINITION) throw new Error("Expected an operation");
  assert.deepEqual(selectedFields(operation.selectionSet),selection);
 });
}
