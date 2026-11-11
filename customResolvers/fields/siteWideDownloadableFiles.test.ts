import assert from 'node:assert/strict';
import test from 'node:test';
import {Kind,type TypeNode} from 'graphql';
import typeDefs from '../../typeDefs.js';
import {siteWideDownloadableFiles} from './siteWideDownloadableFiles.js';
test('sitewide file source preserves raw maps and empty fallback',()=>{
 const file={id:null,scanStatus:['raw']};
 assert.equal(siteWideDownloadableFiles({DownloadableFiles:[null,file]})[0],file);
 for(const parent of [null,undefined,{}, {DownloadableFiles:null},{DownloadableFiles:[]}]) assert.deepEqual(siteWideDownloadableFiles(parent),[]);
});
test('sitewide custom list retains its sole owned schema producer',()=>{
 function named(type:TypeNode):string{return type.kind===Kind.NAMED_TYPE?type.name.value:named(type.type);}
 const owners=(name:string)=>typeDefs.definitions.flatMap(definition=>
  definition.kind===Kind.OBJECT_TYPE_DEFINITION||definition.kind===Kind.OBJECT_TYPE_EXTENSION
   ?(definition.fields??[]).filter(field=>named(field.type)===name).map(field=>`${definition.name.value}.${field.name.value}`):[]);
 assert.deepEqual(owners('SiteWideDiscussionListItem'),['SiteWideDiscussionListFormat.discussions']);
 assert.deepEqual(owners('SiteWideDiscussionListFormat'),['Query.getSiteWideDiscussionList']);
});
