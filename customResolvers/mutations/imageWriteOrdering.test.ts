import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import type {Driver} from 'neo4j-driver';
import type {GraphQLContext} from '../../types/context.js';
import type {GraphQLResolveInfo} from 'graphql';
import createImage from './createImageWithUploader.js';
import profile from './setProfileImage.js';
import icon from './setChannelIcon.js';
import {denyImageExternalIo} from '../../tests/denyImageExternalIo.js';
let guard:ReturnType<typeof denyImageExternalIo>;
before(()=>{guard=denyImageExternalIo();});afterEach(()=>guard.assertUnused());after(()=>guard.restore());
for(const kind of ['image','profile','icon'] as const)for(const failure of ['none','variant','write','claim','empty'] as const)test(`${kind} preserves ${failure} failure window`,async()=>{
 const order:string[]=[];const error=new Error('fixture '+failure);
 const metadata:Record<string,unknown>={storageBucket:'fixture',storageObjectName:'obj',storageUrl:'https://example.test/image',uploadedAt:'2026-01-01T00:00:00Z',uploadedByUsername:'alice',uploadedByIp:null};
 const driver={session:({defaultAccessMode}:{defaultAccessMode:string})=>({run:async()=>{const step=defaultAccessMode==='READ'?'metadata':'claim';order.push(step);if(step===failure)throw error;return {records:[{get:(key:string)=>metadata[key]}]};},close:async()=>{}})} as unknown as Driver;
 const generateVariants=async()=>{order.push('variant');if(failure==='variant')throw error;return {variantUrls:{},variantStorageObjectNames:{}};};
 const write=async()=>{order.push('write');if(failure==='write')throw error;return failure==='empty'?[]:[{id:'image',username:'alice',uniqueName:'forum'}];};
 const context={user:{username:'alice'}} as GraphQLContext;
 // Identity helper returns an existing authenticated context user unchanged.
 const invoke=()=>kind==='image'?createImage({driver,generateVariants,repository:{findUploader:async()=>{order.push('uploader');return [{username:'alice'}];},createImage:async()=>({images:await write() as any})}})(null,{input:{storageObjectName:'obj'}},context,{} as GraphQLResolveInfo):kind==='profile'?profile({driver,generateVariants,repository:{setProfileImage:async()=>({users:await write()})}})(null,{username:'alice',imageUrl:'https://example.test/image'},context):icon({driver,generateVariants,repository:{setChannelIcon:async()=>({channels:await write()})}})(null,{channelUniqueName:'forum',imageUrl:'https://example.test/image'},context);
 const success=failure==='none'||(kind==='image'&&failure==='variant');
 if(success)assert.ok(await invoke());else await assert.rejects(invoke(),error=>{const message=(error as Error).message;assert.equal(message, failure==='empty'?(kind==='image'?'Failed to create image: Failed to create image.':kind==='profile'?'User not found':'Channel not found'):(kind==='image'?'Failed to create image: ':'')+'fixture '+failure);return true;});
 const expected=kind==='image'?['uploader','metadata','variant']:['metadata','variant'];
 if(failure!=='variant'||kind==='image')expected.push('write');
 if(success||failure==='claim')expected.push('claim');assert.deepEqual(order,expected);
});
