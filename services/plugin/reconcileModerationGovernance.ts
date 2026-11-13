import { parseModerationSettings } from './moderationGovernance.js'
/** Declarative manifests may add approvals, but removing one is an explicit admin operation. */
export const preserveModerationGovernance = (current: unknown, desired: Record<string, unknown>): Record<string, unknown> => {
  const parsed = parseModerationSettings(current)
  const previous = {...parseModerationSettings(parsed.server), ...parsed}
  const result = {...parseModerationSettings(desired.server), ...desired}
  for (const key of ['serverRuleEnforcement','channelRuleEligibility','channelRuleAllowlist','serverRuleCheckMode','serverRuleForumAllowlist']) {
    if (!Object.prototype.hasOwnProperty.call(result,key) && Object.prototype.hasOwnProperty.call(previous,key)) result[key] = previous[key]
  }
  const oldList = previous.channelRuleAllowlist
  const newList = result.channelRuleAllowlist
  if (Array.isArray(oldList) && oldList.every(v=>typeof v==='string') && Array.isArray(newList) && newList.every(v=>typeof v==='string')) {
    result.channelRuleAllowlist = [...new Set([...newList,...oldList])]
  }
  if (Object.prototype.hasOwnProperty.call(result,'serverRuleEnforcement')) {
    delete result.serverRuleCheckMode
  }
  return result
}
