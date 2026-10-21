import assert from 'node:assert/strict';
import {before,after,afterEach,test} from 'node:test';
import type {GraphQLContext} from '../../types/context.js';
import {lockWikiPage,unlockWikiPage} from './wikiPageLocks.js';
import {pinWikiPageToChannel} from './wikiPagePins.js';
import {setFeaturedWikiPages} from './setFeaturedWikiPages.js';
import type {WikiLockRepository} from '../../services/persistence/wikiActionRepository.js';
import {denyExternalHttp} from '../../tests/denyExternalHttp.js';
let guard:ReturnType<typeof denyExternalHttp>;before(()=>{guard=denyExternalHttp();});afterEach(()=>guard.assertUnused());after(()=>guard.restore());
for(const kind of ['lock','unlock','pin'] as const)test(`${kind} starts both snapshots before permission check and writes`,async()=>{
 const order:string[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const repository:WikiLockRepository={findChannel:async()=>{order.push('channel');await pending;return [{uniqueName:'forum'}];},findPage:async()=>{order.push('page');release();return [{id:'wiki',Channel:{uniqueName:'forum'},locked:kind==='unlock'}];},updateLock:async()=>{order.push('write');return {wikiPages:[{id:'wiki'}] as any};}};
 const driver={session:()=>({run:async()=>{order.push('write');},close:async()=>{order.push('close');}})} as any;
 const checkPermissions=async()=>{order.push('permission');return true as const;};
 const resolver=kind==='lock'?lockWikiPage({driver,repository,checkPermissions}):kind==='unlock'?unlockWikiPage({driver,repository,checkPermissions}):pinWikiPageToChannel({driver,repository,checkPermissions});
 await resolver(null,{channelUniqueName:'forum',wikiPageId:'wiki',reason:' reason '},{user:{username:'moderator'}} as GraphQLContext);
 assert.deepEqual(order,['channel','page','permission','write',...(kind==='pin'?['close']:[])]);
});
for(const kind of ['lock','unlock'] as const)test(`${kind} cross-channel property cannot substitute relationship scope`,async()=>{
 const repository={findChannel:async()=>[{uniqueName:'forum'}],findPage:async()=>[{id:'wiki',channelUniqueName:'forum',Channel:{uniqueName:'other'},locked:kind==='unlock'}],updateLock:async()=>{throw new Error('unexpected write');}};
 let permissions=0;const resolver=(kind==='lock'?lockWikiPage:unlockWikiPage)({driver:{} as never,repository,checkPermissions:async()=>{permissions++;return true as const;}});
 await assert.rejects(resolver(null,{channelUniqueName:'forum',wikiPageId:'wiki',reason:'r'},{} as GraphQLContext),/does not belong/);assert.equal(permissions,0);
});
test('featured empty ids skip page read but preserve server→update order',async()=>{
 const order:string[]=[];const resolver=setFeaturedWikiPages({driver:{} as never,repository:{findServer:async()=>{order.push('server');return [{serverName:'s'}];},findPages:async()=>{throw new Error('unexpected pages');},setFeaturedPages:async(_,ids)=>{order.push('write');assert.deepEqual(ids,[]);return {serverConfigs:[{serverName:'s'}] as any};}}});await resolver(null,{serverName:'s',wikiPageIds:[]});assert.deepEqual(order,['server','write']);
});
