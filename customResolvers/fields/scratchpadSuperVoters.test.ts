import assert from 'node:assert/strict';
import test from 'node:test';
import {scratchpadSuperVoters} from './scratchpadSuperVoters.js';
test('scratchpad voter field preserves the raw list identity and nullable fallback',()=>{
 const rows=[{username:null},{username:['raw']}];
 assert.equal(scratchpadSuperVoters({superUpvotedByUsers:rows}),rows);
 for(const parent of [{},{superUpvotedByUsers:null},{superUpvotedByUsers:undefined}]) assert.deepEqual(scratchpadSuperVoters(parent),[]);
});
