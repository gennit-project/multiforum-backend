import assert from 'node:assert/strict'
import test from 'node:test'
import type { GraphQLContext } from '../../types/context.js'
import { createPluginManagementCapabilityResolver } from './getPluginManagementCapability.js'
test('plugin management capability uses the same effective permission and fails closed on denials',async()=>{
  const context={} as GraphQLContext
  for(const expected of [true,false,new Error('permission denied')]) {
    const resolver=createPluginManagementCapabilityResolver(async(permission,received,options)=>{
      assert.deepEqual(options,{readOnly:true});assert.equal(permission,'canManagePlugins');assert.equal(received,context);return expected
    })
    assert.equal(await resolver(null,{},context),expected===true)
  }
  await assert.rejects(createPluginManagementCapabilityResolver(async()=>{throw new Error('lookup failed')})(null,{},context),/lookup failed/)
})

test('effective capability includes root and tier grants, denies restricted or suspended admins, without write effects', async()=>{
  const originalRoot=process.env.SUPERADMIN_EMAIL
  process.env.SUPERADMIN_EMAIL='root@example.test'
  try {
    for(const scenario of [
      {name:'root',root:true,admin:false,superAdmin:false,suspended:true,expired:false,adminGrant:false,expected:true},
      {name:'superadmin',root:false,admin:false,superAdmin:true,suspended:false,expired:false,adminGrant:false,expected:true},
      {name:'admin',root:false,admin:true,superAdmin:false,suspended:false,expired:false,adminGrant:true,expected:true},
      {name:'restricted',root:false,admin:true,superAdmin:false,suspended:false,expired:false,adminGrant:false,expected:false},
      {name:'suspended',root:false,admin:true,superAdmin:false,suspended:true,expired:false,adminGrant:true,expected:false},
      {name:'expired',root:false,admin:true,superAdmin:false,suspended:false,expired:true,adminGrant:true,expected:true},
      {name:'ordinary',root:false,admin:false,superAdmin:false,suspended:false,expired:false,adminGrant:false,expected:false},
    ]) {
      let effects=0
      const context={user:{username:'actor',email:scenario.root?'root@example.test':'actor@example.test',data:{}},
        driver:{session:()=>({run:async()=>({records: scenario.suspended||scenario.expired ? [{get:()=>({id:'suspension',suspendedIndefinitely:scenario.suspended,suspendedUntil:scenario.expired?'2000-01-01T00:00:00Z':null})}]:[]}),close:async()=>{}})},
        permissionServerConfigRepository:{findByName:async()=>({DefaultServerRole:{canManagePlugins:false},DefaultSuspendedRole:{canManagePlugins:false},DefaultAdminRole:{canManagePlugins:scenario.adminGrant},DefaultSuperAdminRole:{canManagePlugins:true},Admins:scenario.admin?[{username:'actor'}]:[],SuperAdmins:scenario.superAdmin?[{username:'actor'}]:[]})},
        suspensionEffectsRepository:{disconnectExpiredServerSuspensions:async()=>{effects++},createBlockNotification:async()=>{effects++;return 'created'}},
      } as unknown as GraphQLContext
      assert.equal(await createPluginManagementCapabilityResolver()(null,{},context),scenario.expected,scenario.name)
      await Promise.resolve()
      assert.equal(effects,0,`${scenario.name} must be read-only`)
    }
  } finally {
    if(originalRoot===undefined) delete process.env.SUPERADMIN_EMAIL
    else process.env.SUPERADMIN_EMAIL=originalRoot
  }
})
