import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { GraphQLObjectType, GraphQLSchema, GraphQLString, graphql, isInputObjectType, type GraphQLFieldConfigMap } from 'graphql'
import { applyMiddleware } from 'graphql-middleware'
import { allow, deny, shield, and } from 'graphql-shield'
import { buildPublicSchema } from '../../build_scripts/publicSchema.js'
import { createChannelPluginGovernanceRule, guardChannelPluginMutationRules, CHANNEL_GOVERNANCE_WRITE_ERROR } from './channelPluginGovernance.js'
import { createChannelInputIsValid, updateChannelInputIsValid } from './channelIsValid.js'
import { MAX_CHARS_IN_DISPLAY_NAME } from './constants.js'
let sourceSchema: GraphQLSchema
before(async()=>{sourceSchema=await buildPublicSchema()})
const enabled = {connect:[{where:{node:{id:{eq:'moderation'}}},edge:{enabled:true}}]}
function environment(options:{lookup?:boolean;authorization?:boolean;validateChannels?:boolean}={}) {
  const writes:string[]=[];const lookups:unknown[]=[]
  const fields:GraphQLFieldConfigMap<unknown,unknown>={}
  for(const name of ['updateChannels','createChannels','updateUsers']) {
    const actual=sourceSchema.getMutationType()!.getFields()[name]
    fields[name]={type:GraphQLString,args:Object.fromEntries(actual.args.map(arg=>[arg.name,{type:arg.type,defaultValue:arg.defaultValue}])),resolve:()=>{writes.push(name);return 'written'}}
  }
  const schema=new GraphQLSchema({query:new GraphQLObjectType({name:'Query',fields:{ping:{type:GraphQLString}}}),
    mutation:new GraphQLObjectType({name:'Mutation',fields})})
  const lookup=createChannelPluginGovernanceRule(()=>async where=>{lookups.push(where);return options.lookup??true})
  const authorization=options.authorization===false?deny:allow
  const guarded=guardChannelPluginMutationRules({
    updateChannels:options.validateChannels?and(authorization,updateChannelInputIsValid):authorization,
    createChannels:options.validateChannels?and(authorization,createChannelInputIsValid):authorization,
    updateUsers:authorization,
  },lookup)
  return {writes,lookups,execute:(query:string,variables?:Record<string,unknown>)=>graphql({
    schema:applyMiddleware(schema,shield({Query:{'*':allow},Mutation:guarded},{allowExternalErrors:true})),source:query,variableValues:variables,contextValue:{},
  })}
}
const executeUpdate=(env:ReturnType<typeof environment>,update:unknown,field='updateChannels',type='ChannelUpdateInput')=>
  env.execute(`mutation($update:${type}){${field}(update:$update)}`,{update})
test('actual generated schema permits the nested path, but shared guard rejects it before mutation resolution',async()=>{
  const env=environment()
  const result=await executeUpdate(env,{RelatedChannels:[{update:{node:{EnabledPlugins:[enabled]}}}]})
  assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR)
  assert.deepEqual(env.writes,[]);assert.equal(env.lookups.length,1)
})
test('alternate user roots, nested create and connect-input paths are governed too',async()=>{
  const payloads=[
    {AdminOfChannels:[{update:{node:{EnabledPlugins:[enabled]}}}]},
    {AdminOfChannels:[{create:[{node:{uniqueName:'new',EnabledPlugins:enabled}}]}]},
    {FavoriteChannels:[{connect:[{where:{node:{uniqueName:{eq:'cats'}}},connect:[{EnabledPlugins:enabled.connect}]}]}]},
  ]
  for(const update of payloads) {
    const env=environment();const result=await executeUpdate(env,update,'updateUsers','UserUpdateInput')
    assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR,JSON.stringify(result.errors))
    assert.deepEqual(env.writes,[])
  }
  const env=environment()
  const result=await env.execute('mutation($input:[ChannelCreateInput!]!){createChannels(input:$input)}',{input:[{uniqueName:'safe'},{uniqueName:'blocked',RelatedChannels:{create:[{node:{uniqueName:'nested',EnabledPlugins:enabled}}]}}]})
  assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR)
  assert.deepEqual(env.writes,[])
})
test('deep repeated relationship traversal and updates to enabled edges are rejected',async()=>{
  let node:Record<string,unknown>={EnabledPlugins:[{update:{where:{node:{id:{eq:'moderation'}}},edge:{enabled:{set:true}}}}]}
  for(let i=0;i<6;i++) node={RelatedChannels:[{update:{node}}]}
  const env=environment();const result=await executeUpdate(env,node)
  assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR);assert.deepEqual(env.writes,[])
})
test('a benign first alias cannot cache permission for a forbidden second alias',async()=>{
  const env=environment();const result=await env.execute(`mutation($bad:ChannelUpdateInput){
    benign:updateChannels(update:{displayName:{set:"fine"}})
    forbidden:updateChannels(update:$bad)
  }`,{bad:{RelatedChannels:[{update:{node:{EnabledPlugins:[enabled]}}}]}})
  assert.equal(result.data?.benign,'written');assert.equal(result.data?.forbidden,null)
  assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR)
  assert.deepEqual(env.writes,['updateChannels']);assert.equal(env.lookups.length,1)
})
test('same-request allowed plugin lookup does not authorize a later broad connect',async()=>{
  let calls=0
  // Separate positive/negative fields use one no-cache rule and one Shield context.
  const actual=sourceSchema.getMutationType()!.getFields().updateChannels
  const schema=new GraphQLSchema({query:new GraphQLObjectType({name:'Query',fields:{ping:{type:GraphQLString}}}),mutation:new GraphQLObjectType({name:'Mutation',fields:{updateChannels:{type:GraphQLString,args:Object.fromEntries(actual.args.map(arg=>[arg.name,{type:arg.type}])),resolve:()=> 'written'}}})})
  const guard=createChannelPluginGovernanceRule(()=>async()=>++calls>1)
  const result=await graphql({schema:applyMiddleware(schema,shield({Mutation:guardChannelPluginMutationRules({updateChannels:allow},guard)},{allowExternalErrors:true})),
    source:'mutation($good:ChannelUpdateInput,$bad:ChannelUpdateInput){first:updateChannels(update:$good) second:updateChannels(update:$bad)}',
    variableValues:{good:{EnabledPlugins:[enabled]},bad:{RelatedChannels:[{update:{node:{EnabledPlugins:[{connect:[{edge:{enabled:true}}]}]}}}]}},contextValue:{}})
  assert.equal(result.data?.first,'written');assert.equal(result.data?.second,null);assert.equal(calls,2)
  assert.equal(result.errors?.[0]?.message,CHANNEL_GOVERNANCE_WRITE_ERROR)
})
test('JSON values are opaque, normal other-plugin writes and disconnects are preserved',async()=>{
  const data=environment();const result=await executeUpdate(data,{pluginPipelines:{set:{EnabledPlugins:[enabled],RelatedChannels:[{update:{node:{EnabledPlugins:[enabled]}}}]}}})
  assert.equal(result.errors,undefined);assert.equal(data.lookups.length,0)
  const normal=environment({lookup:false});assert.equal((await executeUpdate(normal,{RelatedChannels:[{update:{node:{EnabledPlugins:[enabled]}}}]})).errors,undefined)
  const disconnect=environment();assert.equal((await executeUpdate(disconnect,{EnabledPlugins:[{disconnect:[{where:{node:{id:{eq:'moderation'}}}}]}]})).errors,undefined);assert.equal(disconnect.lookups.length,0)
})
test('authorization denial happens before target lookup or resolver execution',async()=>{
  const env=environment({authorization:false});const result=await executeUpdate(env,{EnabledPlugins:[enabled]})
  assert.ok(result.errors?.length);assert.deepEqual(env.lookups,[]);assert.deepEqual(env.writes,[])
})
test('channel validation also rechecks later aliases rather than caching the first result',async()=>{
  const env=environment({validateChannels:true});const result=await env.execute(`mutation($bad:ChannelUpdateInput){
    first:updateChannels(update:{displayName:{set:"fine"}}) second:updateChannels(update:$bad)
  }`,{bad:{displayName:{set:'x'.repeat(MAX_CHARS_IN_DISPLAY_NAME+1)}}})
  assert.equal(result.data?.first,'written');assert.equal(result.data?.second,null);assert.match(result.errors?.[0]?.message??'',/display name cannot exceed/)
  assert.deepEqual(env.writes,['updateChannels'])
})
test('all generated channel-plugin mutation input kinds are explicitly covered',()=>{
  const kinds=Object.values(sourceSchema.getTypeMap()).filter(type=>isInputObjectType(type)&&/^ChannelEnabledPlugins.*(?:FieldInput|ConnectionInput)$/.test(type.name)).map(type=>type.name).sort()
  assert.deepEqual(kinds,['ChannelEnabledPluginsConnectFieldInput','ChannelEnabledPluginsCreateFieldInput','ChannelEnabledPluginsDeleteFieldInput','ChannelEnabledPluginsDisconnectFieldInput','ChannelEnabledPluginsFieldInput','ChannelEnabledPluginsUpdateConnectionInput','ChannelEnabledPluginsUpdateFieldInput'])
})
