import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {getServerConfigForPermissions} from './getServerConfigForPermissions.js';
import {getPermissionRequestCache} from './getPermissionRequestCache.js';
import {evaluateServerScopedMembership} from './getServerScopedMembership.js';
import type {GraphQLContext} from '../../types/context.js';
import type {PermissionServerConfig} from '../../services/persistence/permissionServerConfigRepository.js';
const empty:PermissionServerConfig={Admins:[],SuperAdmins:[],Moderators:[],SuspendedUsers:[],SuspendedMods:[]};
test('permission cache shares a pending lookup and retains null without refetching',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('cache','unused'));
 try{
  const context:GraphQLContext={driver};let calls=0;let resolve!:(value:PermissionServerConfig|null)=>void;
  const pending=new Promise<PermissionServerConfig|null>(done=>{resolve=done;});
  const repository={findByName:async()=>{calls++;return pending;}};
  const first=getServerConfigForPermissions(context,repository),second=getServerConfigForPermissions(context,repository);
  assert.equal(calls,1);resolve(null);assert.deepEqual(await Promise.all([first,second]),[null,null]);
  assert.equal(await getServerConfigForPermissions(context,repository),null);assert.equal(calls,1);
 }finally{await driver.close();}
});
test('permission cache retains the same rejection in one request and isolates another request',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('cache','unused'));
 try{
  const first:GraphQLContext={driver},second:GraphQLContext={driver};const failure=new Error('permission lookup failed');let calls=0;
  const repository={findByName:async()=>{calls++;if(calls===1)throw failure;return empty;}};
  for(let i=0;i<2;i++)await assert.rejects(getServerConfigForPermissions(first,repository),error=>error===failure);
  assert.equal(calls,1);assert.equal(await getServerConfigForPermissions(second,repository),empty);assert.equal(calls,2);
  assert.notEqual(getPermissionRequestCache(first),getPermissionRequestCache(second));
 }finally{await driver.close();}
});
test('nullable membership identities do not confer privileges, while exact matching identities still do',()=>{
 assert.deepEqual(evaluateServerScopedMembership({username:'reader',modProfileName:'Reader',serverAdminUsernames:[null,undefined],serverSuperAdminUsernames:[null],serverModeratorDisplayNames:[undefined]}),{isServerAdmin:false,isServerModerator:false});
 assert.deepEqual(evaluateServerScopedMembership({username:null,modProfileName:null,serverAdminUsernames:[null],serverModeratorDisplayNames:[null]}),{isServerAdmin:false,isServerModerator:false});
 assert.deepEqual(evaluateServerScopedMembership({username:'reader',modProfileName:'Reader',serverAdminUsernames:[null,'reader'],serverModeratorDisplayNames:[undefined,'Reader']}),{isServerAdmin:true,isServerModerator:true});
});
