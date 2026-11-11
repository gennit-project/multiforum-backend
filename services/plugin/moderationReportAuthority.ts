import type { Driver } from 'neo4j-driver'
import type { ReportContentAsBotInput } from '../botReportService.js'
import { resolveNeo4jDatabase } from '../neo4jDatabase.js'
import { USER_SUSPENSION_QUERY, isExpiredServerSuspension } from '../../rules/permission/getActiveServerSuspension.js'
import { MODERATION_PLUGIN_ID, parseModerationSettings } from './moderationGovernance.js'

/** Return only the mandatory server portion, never channel-owned enforcement. */
export const mandatoryServerReport = (
  pluginId: string, settings: unknown, serverRules: string[], input: ReportContentAsBotInput,
): ReportContentAsBotInput | null => {
  const parsed = parseModerationSettings(settings)
  const enforcement = Object.prototype.hasOwnProperty.call(parsed, 'serverRuleEnforcement')
    ? parsed.serverRuleEnforcement : parseModerationSettings(parsed.server).serverRuleEnforcement
  if (pluginId !== MODERATION_PLUGIN_ID || enforcement !== 'on') return null
  const canonical = new Set(serverRules.filter(rule => typeof rule === 'string').map(rule => rule.trim()).filter(Boolean))
  const selectedServerRules = [...new Set((input.selectedServerRules || []).filter(rule => canonical.has(rule)))]
  if (!selectedServerRules.length) return null
  if (!input.selectedForumRules?.length && selectedServerRules.length === input.selectedServerRules.length) return input
  // The model's combined rationale/recommendation may rely on channel rules.
  // Do not carry those judgments through an exception for server enforcement.
  return {
    ...input, selectedServerRules, selectedForumRules: [],
    reportText: `Server-rule review requested: ${selectedServerRules.join('; ')}`,
    recommendedAction: null, recommendationConfidence: null, recommendationRationale: null,
  }
}

/** Server admins retain suspension authority even for mandatory reporting. */
export const hasActiveServerBotSuspension = async (
  driver: Driver, serverName: string, username: string,
): Promise<boolean> => {
  if (!serverName) throw new Error('Server name is required to verify mandatory bot report suspension.')
  const session = driver.session({ database: resolveNeo4jDatabase() })
  try {
    const result = await session.run<{ suspension: { suspendedUntil?: string | null; suspendedIndefinitely?: unknown } }>(
      USER_SUSPENSION_QUERY, { serverName, username },
    )
    const now = new Date()
    return result.records.some(record => !isExpiredServerSuspension(record.get('suspension'), now))
  } finally {
    await session.close()
  }
}
