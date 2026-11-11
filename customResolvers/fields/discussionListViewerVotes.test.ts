import assert from 'node:assert/strict';
import test from 'node:test';
import { discussionListViewerVotes } from './discussionListViewerVotes.js';
for (const field of ['UpvotedByUsers','SuperUpvotedByUsers'] as const) {
  test(`${field} preserves the exact viewer map and empty fallback`,()=>{
    const resolve=discussionListViewerVotes(field);
    const viewer={username:'actor'};
    assert.equal(resolve({[field]:[null,viewer]})[0],viewer);
    for(const parent of [undefined,null,{}, {[field]:null},{[field]:[]}]) assert.deepEqual(resolve(parent),[]);
  });
}

import { Kind, type TypeNode } from 'graphql';
import typeDefs from '../../typeDefs.js';
test('discussion viewer list fields retain their single owned schema producer',()=>{
  function named(type:TypeNode):string {return type.kind===Kind.NAMED_TYPE?type.name.value:named(type.type);}
  const owners=(name:string)=>typeDefs.definitions.flatMap(definition=>
    definition.kind===Kind.OBJECT_TYPE_DEFINITION||definition.kind===Kind.OBJECT_TYPE_EXTENSION
      ? (definition.fields??[]).filter(field=>named(field.type)===name).map(field=>`${definition.name.value}.${field.name.value}`):[]);
  assert.deepEqual(owners('DiscussionChannelListItem'),['DiscussionChannelListFormat.discussionChannels']);
  assert.deepEqual(owners('DiscussionChannelListFormat'),['Query.getDiscussionsInChannel']);
});
