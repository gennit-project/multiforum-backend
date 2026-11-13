import { randomUUID } from 'node:crypto'
import { int, type Driver, type ManagedTransaction } from 'neo4j-driver'
import { executeManagedWrite } from '../neo4jTransactions.js'
import { compareVersions } from '../plugin/pipelineUtils.js'
import { isChannelRuleEligible, parseModerationSettings, serverRuleScope, serverRulesApply } from '../plugin/moderationGovernance.js'

export const MODERATION_PLUGIN = 'llm-moderation'
export const CHANNEL_RULE_REQUEST = 'CHANNEL_RULE_ENFORCEMENT'
export type GovernanceInstallation = { id: string; version: string; settings: Record<string, unknown> }
export type ChannelRuleEnforcementRequest = { id: string; issueNumber: number; channelUniqueName: string; pluginId: string; isOpen: boolean }
export type ChannelRuleGovernance = {
  pluginId: string; version: string | null; serverRuleEnforcement: string; serverRulesApply: boolean
  channelRuleEligibility: string; channelRuleAllowlist: string[]; eligible: boolean
  ownerEnabled: boolean; canRequest: boolean; pendingRequestId: string | null
  pendingRequestNumber: number | null; migrationRequired: boolean
}
const requirePlugin = (pluginId: string) => {
  if (pluginId !== MODERATION_PLUGIN) throw new Error('Channel-rule governance is only supported for llm-moderation.')
}
const settingsPolicy = (settings: Record<string, unknown>) => {
  const nested = parseModerationSettings(settings.server)
  return { ...nested, ...settings }
}
export const governanceStatus = (installation: GovernanceInstallation | null, channelUniqueName: string,
  ownerEnabled: boolean, pending: ChannelRuleEnforcementRequest | null): ChannelRuleGovernance => {
  const settings = settingsPolicy(installation?.settings ?? {})
  const mode = Object.prototype.hasOwnProperty.call(settings, 'channelRuleEligibility') ? settings.channelRuleEligibility : 'all'
  const eligibility = ['all', 'none', 'allowlist'].includes(String(mode)) ? String(mode) : 'none'
  const eligible = Boolean(installation) && isChannelRuleEligible(settings, channelUniqueName)
  return {
    pluginId: MODERATION_PLUGIN, version: installation?.version ?? null,
    serverRuleEnforcement: installation ? serverRuleScope(settings) : 'off',
    serverRulesApply: Boolean(installation) && serverRulesApply(settings, channelUniqueName),
    channelRuleEligibility: installation ? eligibility : 'none',
    channelRuleAllowlist: Array.isArray(settings.channelRuleAllowlist) && settings.channelRuleAllowlist.every(v => typeof v === 'string')
      ? settings.channelRuleAllowlist.map(v => v.trim()).filter(Boolean) : [],
    eligible, ownerEnabled, canRequest: Boolean(installation) && eligibility === 'allowlist' && !eligible && !pending,
    pendingRequestId: pending?.id ?? null, pendingRequestNumber: pending?.issueNumber ?? null, migrationRequired: false,
  }
}
async function installation(tx: ManagedTransaction): Promise<GovernanceInstallation | null> {
  const result = await tx.run(`MATCH (:ServerConfig)-[e:INSTALLED]->(v:PluginVersion)<-[:HAS_VERSION]-(:Plugin {name:$pluginId})
    WHERE e.enabled = true RETURN v.id AS id, v.version AS version, e.settingsJson AS settings`, { pluginId: MODERATION_PLUGIN })
  return result.records.map(r => ({ id: String(r.get('id')), version: String(r.get('version')),
    settings: parseModerationSettings(r.get('settings')) })).sort((a,b) => compareVersions(b.version,a.version))[0] ?? null
}
async function lockServer(tx: ManagedTransaction) {
  const result = await tx.run('MATCH (s:ServerConfig) SET s._channelGovernanceLock = true REMOVE s._channelGovernanceLock RETURN count(s) AS count')
  if (Number(result.records[0]?.get('count')) !== 1) throw new Error('Exactly one server configuration is required.')
}
async function assertChannel(tx: ManagedTransaction, channel: string) {
  const result = await tx.run('MATCH (c:Channel {uniqueName:$channel}) WHERE coalesce(c.deleted,false) = false RETURN count(c) AS count', {channel})
  if (Number(result.records[0]?.get('count')) !== 1) throw new Error('Channel not found.')
}
const requestFromRecord = (value: Record<string, unknown>): ChannelRuleEnforcementRequest => ({
  id: String(value.id), issueNumber: Number(value.issueNumber), channelUniqueName: String(value.relatedChannelUniqueName),
  pluginId: String(value.requestedPluginId), isOpen: value.isOpen === true,
})
async function pendingRequest(tx: ManagedTransaction, channel: string) {
  const result = await tx.run(`MATCH (i:Issue {requestKind:$kind, requestedPluginId:$pluginId, relatedChannelUniqueName:$channel, isOpen:true})
    WHERE i.channelUniqueName IS NULL RETURN properties(i) AS issue ORDER BY i.createdAt LIMIT 1`,
  { kind: CHANNEL_RULE_REQUEST, pluginId: MODERATION_PLUGIN, channel })
  return result.records[0] ? requestFromRecord(result.records[0].get('issue')) : null
}
export interface ChannelRuleGovernanceRepository {
  status(channel: string, pluginId: string): Promise<ChannelRuleGovernance>
  setEnabled(channel: string, pluginId: string, enabled: boolean, settingsJson?: Record<string, unknown>): Promise<boolean>
  request(channel: string, pluginId: string, username: string): Promise<ChannelRuleEnforcementRequest>
  approve(issueId: string, username: string): Promise<ChannelRuleEnforcementRequest>
}
export const createChannelRuleGovernanceRepository = (driver: Driver): ChannelRuleGovernanceRepository => ({
  async status(channel,pluginId) {
    requirePlugin(pluginId)
    return executeManagedWrite(driver, async tx => {
      await assertChannel(tx,channel)
      const installed = await installation(tx)
      const enabled = installed ? await tx.run('MATCH (:Channel {uniqueName:$channel})-[e:ENABLED]->(:PluginVersion {id:$id}) RETURN e.enabled AS enabled', {channel,id:installed.id}) : null
      return governanceStatus(installed,channel,enabled?.records.some(r => r.get('enabled') === true) ?? false,await pendingRequest(tx,channel))
    })
  },
  async setEnabled(channel,pluginId,enabled,settingsJson) {
    requirePlugin(pluginId)
    return executeManagedWrite(driver, async tx => {
      await lockServer(tx)
      await assertChannel(tx,channel)
      const installed = await installation(tx)
      if (enabled && (!installed || !isChannelRuleEligible(installed.settings,channel))) throw new Error('Channel is not eligible for channel-rule enforcement.')
      await tx.run('MATCH (:Channel {uniqueName:$channel})-[e:ENABLED]->(:PluginVersion)<-[:HAS_VERSION]-(:Plugin {name:$pluginId}) SET e.enabled = false', {channel,pluginId})
      if (enabled && installed) await tx.run('MATCH (c:Channel {uniqueName:$channel}), (v:PluginVersion {id:$id}) MERGE (c)-[e:ENABLED]->(v) SET e.enabled = true', {channel,id:installed.id})
      if (enabled && installed && settingsJson !== undefined) await tx.run('MATCH (:Channel {uniqueName:$channel})-[e:ENABLED]->(:PluginVersion {id:$id}) SET e.settingsJson=$settings', {channel,id:installed.id,settings:JSON.stringify(settingsJson)})
      return true
    })
  },
  async request(channel,pluginId,username) {
    requirePlugin(pluginId)
    return executeManagedWrite(driver, async tx => {
      await lockServer(tx)
      await assertChannel(tx,channel)
      const pending = await pendingRequest(tx,channel)
      if (pending) return pending
      const status = governanceStatus(await installation(tx),channel,false,null)
      if (!status.canRequest) throw new Error('This channel cannot request channel-rule enforcement under the current policy.')
      const author = await tx.run('MATCH (u:User {username:$username}) RETURN count(u) AS count',{username})
      if (Number(author.records[0]?.get('count')) !== 1) throw new Error('Request author not found.')
      const counter = await tx.run(`MERGE (counter:ServerIssueCounter {scope:'server'}) ON CREATE SET counter.current=0
        SET counter.current=counter.current WITH counter OPTIONAL MATCH (i:Issue) WHERE i.channelUniqueName IS NULL
        WITH counter,coalesce(max(i.issueNumber),0) AS highest
        SET counter.current=CASE WHEN counter.current < highest THEN highest ELSE counter.current END + 1 RETURN counter.current AS number`)
      const issueNumber = Number(counter.records[0].get('number'))
      const id = randomUUID()
      await tx.run(`MATCH (c:Channel {uniqueName:$channel}), (u:User {username:$username})
        CREATE (i:Issue {id:$id,issueNumber:$number,title:$title,body:$body,isOpen:true,authorName:$username,
          requestKind:$kind,requestedPluginId:$pluginId,relatedChannelUniqueName:$channel,
          flaggedServerRuleViolation:false,createdAt:datetime(),updatedAt:datetime()})
        CREATE (i)-[:TARGETS_CHANNEL]->(c) CREATE (i)-[:AUTHORED_ISSUE]->(u)`,
      {channel,username,id,number:int(issueNumber),kind:CHANNEL_RULE_REQUEST,pluginId,
        title:`Request channel-rule enforcement for ${channel}`,body:`Please approve ${pluginId} channel-rule enforcement eligibility for ${channel}.`})
      return {id,issueNumber,channelUniqueName:channel,pluginId,isOpen:true}
    })
  },
  async approve(issueId,username) {
    return executeManagedWrite(driver, async tx => {
      await lockServer(tx)
      const result = await tx.run('MATCH (i:Issue {id:$issueId,requestKind:$kind,requestedPluginId:$pluginId}) WHERE i.channelUniqueName IS NULL RETURN properties(i) AS issue',
      {issueId,kind:CHANNEL_RULE_REQUEST,pluginId:MODERATION_PLUGIN})
      if (!result.records[0]) throw new Error('Channel-rule request not found.')
      const raw = result.records[0].get('issue') as Record<string,unknown>
      const request = requestFromRecord(raw)
      if (!request.isOpen) {
        if (raw.channelRuleApprovedAt) return request
        throw new Error('This request is closed.')
      }
      await assertChannel(tx,request.channelUniqueName)
      const installed = await installation(tx)
      if (!installed || settingsPolicy(installed.settings).channelRuleEligibility !== 'allowlist') throw new Error('Channel-rule eligibility policy is no longer allowlist.')
      const current = settingsPolicy(installed.settings).channelRuleAllowlist
      if (current != null && (!Array.isArray(current) || !current.every(v=>typeof v==='string'))) throw new Error('Channel-rule allowlist is invalid.')
      const settings = {...installed.settings, channelRuleAllowlist:[...new Set([...(current as string[] ?? []),request.channelUniqueName])]}
      await tx.run('MATCH (:ServerConfig)-[e:INSTALLED]->(:PluginVersion {id:$id}) SET e.settingsJson=$settings', {id:installed.id,settings:JSON.stringify(settings)})
      await tx.run('MATCH (i:Issue {id:$issueId}) SET i.isOpen=false,i.channelRuleApprovedAt=datetime(),i.channelRuleApprovedBy=$username,i.updatedAt=datetime()',{issueId,username})
      return {...request,isOpen:false}
    })
  },
})
