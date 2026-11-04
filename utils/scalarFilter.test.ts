import assert from "node:assert/strict";
import test from "node:test";
import { stringFromScalarFilter } from "./scalarFilter.js";

test("reads the eq value from a v7 scalar filter", () => {
  assert.equal(stringFromScalarFilter({ eq: "c-1" }), "c-1");
});

test("tolerates a legacy flat string", () => {
  assert.equal(stringFromScalarFilter("c-1"), "c-1");
});

test("returns undefined for an empty filter", () => {
  assert.equal(stringFromScalarFilter({}), undefined);
});

test("returns undefined for null/undefined", () => {
  assert.equal(stringFromScalarFilter(null), undefined);
});

test("returns undefined for an empty-string eq", () => {
  assert.equal(stringFromScalarFilter({ eq: "" }), undefined);
});

test('permission candidate IDs support generated equality and membership filters without widening text filters',async()=>{
  const {idsFromScalarFilter}=await import('./scalarFilter.js');
  assert.deepEqual(idsFromScalarFilter('legacy'),['legacy']);
  assert.deepEqual(idsFromScalarFilter({eq:'one'}),['one']);
  assert.deepEqual(idsFromScalarFilter({in:['one','two']}),['one','two']);
  assert.deepEqual(idsFromScalarFilter({eq:'one',in:['one','two']}),['one']);
  for(const value of [undefined,null,{}, {contains:'one'},{startsWith:'one'}, {in:[]}]) assert.deepEqual(idsFromScalarFilter(value),[]);
});
