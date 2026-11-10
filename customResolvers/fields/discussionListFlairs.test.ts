import assert from 'node:assert/strict';
import test from 'node:test';
import { discussionListFlairs } from './discussionListFlairs.js';
import type { DiscussionListFlair } from '../contracts/discussionListFlairs.js';
test('flair source preserves raw values and filters only null items',()=>{
  const source:DiscussionListFlair={id:17,channelUniqueName:null,displayName:['raw'],color:null,order:'raw',archived:null};
  assert.equal(discussionListFlairs({Flairs:[null,source]})[0],source);
  assert.deepEqual(source,{id:17,channelUniqueName:null,displayName:['raw'],color:null,order:'raw',archived:null});
});
test('flair source preserves missing and empty list fallback',()=>{
  for(const source of [null,undefined,{}, {Flairs:null},{Flairs:[]}]) assert.deepEqual(discussionListFlairs(source),[]);
});
