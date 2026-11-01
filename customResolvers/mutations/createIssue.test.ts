import assert from 'node:assert/strict';
import {test} from 'node:test';
import createIssue from './createIssue.js';
import type {Driver} from 'neo4j-driver';
import type {GraphQLContext} from '../../types/context.js';
const context = () => ({user:{username:'alice',email:null,email_verified:true,data:null}} as GraphQLContext);
const driver = {session(){throw new Error('must not allocate');}} as unknown as Driver;
test('empty text fails before allocating a number',async()=>{
 await assert.rejects(createIssue({driver})(null,{input:{title:' ',body:'body'}},context()),/Title and body/);
});
test('a caller cannot select an unavailable moderation persona',async()=>{
 await assert.rejects(createIssue({driver})(null,{input:{title:'title',body:'body',asModerationProfile:true}},context()),/moderation profile/);
});
test('conflicting targets fail before allocating a number',async()=>{
 await assert.rejects(createIssue({driver})(null,{input:{title:'title',body:'body',relatedDiscussionId:'d',relatedImageId:'i'}},context()),/one primary target/);
});
