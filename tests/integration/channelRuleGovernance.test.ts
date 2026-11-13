import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Neo4jGraphQL } from '@neo4j/graphql'
import { graphql, type GraphQLSchema, type GraphQLResolveInfo } from 'graphql'
import { applyMiddleware } from 'graphql-middleware'
import type { Driver } from 'neo4j-driver'
import typeDefs from '../../typeDefs.js'
import permissions from '../../permissions.js'
import getCustomResolvers from '../helpers/getTestResolvers.js'
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js'
import { createChannelRuleGovernanceRepository } from '../../services/persistence/channelRuleGovernanceRepository.js'
import { createServerPluginEnablementRepository } from '../../services/persistence/serverPluginEnablementRepository.js'
import { createApplyPluginConfigurationResolver } from '../../customResolvers/mutations/applyPluginConfiguration.js'
import { buildPluginConfigurationReconciliationPlan, PLUGIN_CONFIGURATION_API_VERSION } from '../../services/plugin/configurationReconciliation.js'
import type { GraphQLContext } from '../../types/context.js'
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js'

let driver: Driver
let schema: GraphQLSchema
before(async () => {
  driver = await startNeo4j()
  const app = getCustomResolvers(driver)
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers }).getSchema()
  registerGeneratedSchema(driver, schema)
}, { timeout: 240000 })
beforeEach(async () => { await resetDatabase(driver) })
after(async () => { await stopNeo4j() })

const pluginId = 'llm-moderation'
const policy = { serverRuleEnforcement: 'on', channelRuleEligibility: 'allowlist', channelRuleAllowlist: [] }
const seed = async () => {
  await driver.executeQuery(`CREATE (:User {username:'owner'}), (:User {username:'admin'}), (:User {username:'visitor'})
    CREATE (cats:Channel {uniqueName:'cats'}), (:Channel {uniqueName:'dogs'})
    CREATE (p:Plugin {id:'p',name:$pluginId})-[:HAS_VERSION]->(v:PluginVersion {id:'v',version:'0.8.0'})
    CREATE (:ServerConfig {serverName:'server'})-[:INSTALLED {enabled:true,settingsJson:$settings}]->(v)
    WITH cats MATCH (u:User {username:'owner'}) CREATE (u)-[:ADMIN_OF_CHANNEL]->(cats)`,
  { pluginId, settings: JSON.stringify(policy) })
}
const repo = () => createChannelRuleGovernanceRepository(driver)
const issue = async (id: string) => (await driver.executeQuery('MATCH (i:Issue {id:$id}) RETURN properties(i) AS issue', {id})).records[0].get('issue')
const changePolicy = async (settings: unknown) => driver.executeQuery('MATCH (:ServerConfig)-[e:INSTALLED]->() SET e.settingsJson=$settings', {settings: JSON.stringify(settings)})

test('request, server approval, then separate owner opt-in persists the complete flow', async () => {
  await seed()
  const repository = repo()
  assert.equal((await repository.status('cats', pluginId)).canRequest, true)
  await assert.rejects(repository.setEnabled('cats', pluginId, true), /not eligible/)
  const request = await repository.request('cats', pluginId, 'owner')
  assert.equal(request.isOpen, true)
  const pending = await repository.status('cats', pluginId)
  assert.equal(pending.pendingRequestId, request.id)
  assert.equal(pending.canRequest, false)
  const stored = await issue(request.id)
  assert.equal(stored.channelUniqueName, undefined, 'request belongs to the server issue queue')
  assert.equal(stored.relatedChannelUniqueName, 'cats')
  const approved = await repository.approve(request.id, 'admin')
  assert.equal(approved.isOpen, false)
  const status = await repository.status('cats', pluginId)
  assert.equal(status.eligible, true)
  assert.equal(status.ownerEnabled, false, 'approval grants eligibility, never owner consent')
  assert.equal(status.serverRuleEnforcement, 'on')
  await repository.setEnabled('cats', pluginId, true)
  assert.equal((await repository.status('cats', pluginId)).ownerEnabled, true)
  await repository.setEnabled('cats', pluginId, false)
  const disabled = await repository.status('cats', pluginId)
  assert.equal(disabled.ownerEnabled, false)
  assert.equal(disabled.eligible, true)
  assert.equal(disabled.serverRuleEnforcement, 'on')
})

test('duplicate concurrent requests and approvals are idempotent', async () => {
  await seed()
  const repository = repo()
  const requests = await Promise.all(Array.from({length: 4}, () => repository.request('cats', pluginId, 'owner')))
  assert.equal(new Set(requests.map(request => request.id)).size, 1)
  assert.equal(new Set(requests.map(request => request.issueNumber)).size, 1)
  const approvals = await Promise.all(Array.from({length: 4}, () => repository.approve(requests[0].id, 'admin')))
  assert.ok(approvals.every(request => request.isOpen === false))
  assert.deepEqual((await repository.status('cats', pluginId)).channelRuleAllowlist, ['cats'])
  assert.equal(Number((await driver.executeQuery('MATCH (i:Issue) RETURN count(i) AS count')).records[0].get('count')), 1)
})

test('concurrent different-channel approvals preserve both allowlist additions', async () => {
  await seed()
  const repository = repo()
  const requests = await Promise.all(['cats', 'dogs'].map(channel => repository.request(channel, pluginId, 'owner')))
  assert.notEqual(requests[0].issueNumber, requests[1].issueNumber)
  await Promise.all(requests.map(request => repository.approve(request.id, 'admin')))
  assert.deepEqual((await repository.status('cats', pluginId)).channelRuleAllowlist.sort(), ['cats', 'dogs'])
})

test('stale policy and malformed allowlist reject approval without closing the request', async () => {
  await seed()
  const repository = repo()
  const request = await repository.request('cats', pluginId, 'owner')
  for (const settings of [{ ...policy, channelRuleEligibility: 'none' }, { ...policy, channelRuleAllowlist: 'cats' }]) {
    await changePolicy(settings)
    await assert.rejects(repository.approve(request.id, 'admin'), /no longer allowlist|invalid/)
    assert.equal((await issue(request.id)).isOpen, true)
    assert.equal((await repository.status('cats', pluginId)).ownerEnabled, false)
  }
})

test('approval refuses channel-local issues and missing or closed requests', async () => {
  await seed()
  const repository = repo()
  const request = await repository.request('cats', pluginId, 'owner')
  await driver.executeQuery("MATCH (i:Issue {id:$id}) SET i.channelUniqueName='cats'", {id: request.id})
  await assert.rejects(repository.approve(request.id, 'admin'), /not found/)
  await driver.executeQuery('MATCH (i:Issue {id:$id}) REMOVE i.channelUniqueName SET i.isOpen=false', {id: request.id})
  await assert.rejects(repository.approve(request.id, 'admin'), /closed/)
  await assert.rejects(repository.approve('missing', 'admin'), /not found/)
})

test('GraphQL permission middleware denies owner and visitor server approval', async () => {
  await seed()
  const repository = repo()
  const request = await repository.request('cats', pluginId, 'owner')
  const protectedSchema = applyMiddleware(schema, permissions)
  for (const viewer of [null, 'visitor', 'owner']) {
    const result = await graphql({
      schema: protectedSchema,
      source: 'mutation Approve($id: ID!) { approveChannelRuleEnforcement(issueId: $id) { id isOpen } }',
      variableValues: {id: request.id},
      contextValue: {driver, req: {headers: {}, isMutation: true}, user: viewer ? {username: viewer, email: null, email_verified: true, data: null} : null, mayAccessSensitiveContent: false},
    })
    assert.ok(result.errors?.length, `${viewer ?? 'anonymous'} must not approve`)
    assert.equal((await issue(request.id)).isOpen, true)
    assert.equal((await repository.status('cats', pluginId)).eligible, false)
  }
})


test('version activation and concurrent approval retain governing grants under the same server lock', async () => {
  await seed()
  const repository = repo()
  const cats = await repository.request('cats', pluginId, 'owner')
  const dogs = await repository.request('dogs', pluginId, 'owner')
  await repository.approve(cats.id, 'admin')
  await driver.executeQuery(`MATCH (p:Plugin {name:$pluginId}), (s:ServerConfig {serverName:'server'})
    CREATE (p)-[:HAS_VERSION]->(v:PluginVersion {id:'new-version',version:'0.9.0'})
    CREATE (s)-[:INSTALLED {enabled:false,settingsJson:$settings}]->(v)`,
  {pluginId, settings:JSON.stringify({...policy,channelRuleAllowlist:['stale-inactive']})})
  await Promise.all([
    repository.approve(dogs.id, 'admin'),
    createServerPluginEnablementRepository(driver).setInstallation('server','new-version',true,
      JSON.stringify({...policy,channelRuleAllowlist:['trial']}),true),
  ])
  const status = await repository.status('cats',pluginId)
  assert.equal(status.version,'0.9.0')
  assert.deepEqual(status.channelRuleAllowlist.sort(),['cats','dogs','trial'])
  assert.equal((await issue(dogs.id)).isOpen,false)
})


for (const disableFirst of [true, false]) {
  test(`declarative upgrade with concurrent approval and old version listed ${disableFirst ? 'first' : 'last'}`, async () => {
    await seed()
    const repository = repo()
    const cats = await repository.request('cats', pluginId, 'owner')
    const dogs = await repository.request('dogs', pluginId, 'owner')
    await repository.approve(cats.id, 'admin')
    await driver.executeQuery(`MATCH (p:Plugin {name:$pluginId}), (s:ServerConfig {serverName:'server'})
      CREATE (p)-[:HAS_VERSION]->(v:PluginVersion {id:'new-version',version:'0.9.0'})
      CREATE (s)-[:INSTALLED {enabled:false,settingsJson:$settings}]->(v)`,
    {pluginId,settings:JSON.stringify(policy)})
    const oldEntry={pluginId,version:'0.8.0',enabled:false}
    const newEntry={pluginId,version:'0.9.0',enabled:true,settingsJson:{...policy,channelRuleAllowlist:['trial']}}
    const desired={apiVersion:PLUGIN_CONFIGURATION_API_VERSION,plugins:disableFirst?[oldEntry,newEntry]:[newEntry,oldEntry]}
    const enablement=createServerPluginEnablementRepository(driver)
    const resolver=createApplyPluginConfigurationResolver({},()=>({
      preview:async()=>{
        const result=await driver.executeQuery(`MATCH (:ServerConfig {serverName:'server'})-[e:INSTALLED]->(v:PluginVersion)<-[:HAS_VERSION]-(:Plugin {name:$pluginId}) RETURN v.version AS version,e.enabled AS enabled,e.settingsJson AS settings`,{pluginId})
        return buildPluginConfigurationReconciliationPlan({desired,live:{plugins:result.records.map(row=>({pluginId,version:String(row.get('version')),enabled:Boolean(row.get('enabled')),settingsJson:row.get('settings')})),secrets:[],pipelines:[]}})
      },
      install:async()=>assert.fail('already installed'),setSecret:async()=>assert.fail('no secret changes'),updatePipelines:async()=>assert.fail('no pipeline changes'),
      configure:async args=>{
        const id=args.version==='0.8.0'?'v':'new-version'
        const settings=args.settingsJson??policy
        if(args.enabled) {
          await Promise.all([repository.approve(dogs.id,'admin'),enablement.setInstallation('server',id,true,JSON.stringify(settings),true)])
        } else await enablement.setInstallation('server',id,false,JSON.stringify(settings),true)
      },
    }))
    const result=await resolver(null,{manifest:desired},{driver} as GraphQLContext,{} as GraphQLResolveInfo)
    assert.equal(result.status,'SUCCEEDED')
    assert.deepEqual((await repository.status('cats',pluginId)).channelRuleAllowlist.sort(),['cats','dogs','trial'])
    const enabled=await driver.executeQuery('MATCH (:ServerConfig)-[e:INSTALLED]->(v:PluginVersion) WHERE e.enabled=true RETURN v.version AS version')
    assert.deepEqual(enabled.records.map(row=>row.get('version')),['0.9.0'])
  })
}

test('GraphQL status and approval keep staged server scope separate from forum eligibility', async () => {
  await seed()
  await changePolicy({...policy, serverRuleEnforcement:'allowlist', serverRuleForumAllowlist:['dogs']})
  const request = await repo().request('cats',pluginId,'owner')
  await repo().approve(request.id,'admin')
  const result = await graphql({schema,source:`query { getChannelRuleGovernance(channelUniqueName:"cats",pluginId:"llm-moderation") { serverRuleEnforcement serverRulesApply eligible ownerEnabled migrationRequired } }`,contextValue:{driver}})
  assert.equal(result.errors,undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getChannelRuleGovernance:{serverRuleEnforcement:'allowlist',serverRulesApply:false,eligible:true,ownerEnabled:false,migrationRequired:false}})
  assert.equal((await repo().status('dogs',pluginId)).serverRulesApply,true)
  const stored = (await driver.executeQuery('MATCH (:ServerConfig)-[e:INSTALLED]->() RETURN e.settingsJson AS settings')).records[0].get('settings')
  assert.deepEqual(JSON.parse(stored).serverRuleForumAllowlist,['dogs'])
  await repo().setEnabled('cats',pluginId,true)
  assert.equal((await repo().status('cats',pluginId)).serverRulesApply,false)
})
