import { isInputObjectType, isListType, isNonNullType, type GraphQLArgument, type GraphQLInputType, type GraphQLResolveInfo } from 'graphql'
import { chain, rule } from 'graphql-shield'
import type { Driver } from 'neo4j-driver'
import type { GraphQLContext } from '../../types/context.js'
import { executeGeneratedOperation } from '../../services/persistence/generatedSchemaOperations.js'

type RecordValue = Record<string, unknown>
type ModerationTargetLookup = (where: RecordValue) => Promise<boolean>
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v]
export const CHANNEL_GOVERNANCE_WRITE_ERROR = 'Use setChannelRuleEnforcement to change llm-moderation channel enablement.'
/** Generic generated writes must not bypass the governed opt-in operation. */
export async function validateChannelPluginWrites(value: unknown,
  targetsModeration: ModerationTargetLookup): Promise<true | string> {
  for (const entry of list(value)) {
    const input = record(entry)
    if (input.create != null || input.delete != null) return CHANNEL_GOVERNANCE_WRITE_ERROR
    for (const connect of list(input.connect)) {
      if (await targetsModeration(record(record(connect).where).node as RecordValue ?? {})) return CHANNEL_GOVERNANCE_WRITE_ERROR
    }
    for (const update of list(input.update)) {
      if (record(update).node != null) return CHANNEL_GOVERNANCE_WRITE_ERROR
      if (await targetsModeration(record(record(update).where).node as RecordValue ?? {})) return CHANNEL_GOVERNANCE_WRITE_ERROR
    }
    // Disconnect only removes opt-in and cannot weaken global enforcement.
  }
  return true
}

/** Follow the generated schema, not property names: JSON values are data, while
 * Channel inputs can be nested under any mutation root or relationship. */
export async function validateChannelPluginMutationArguments(
  args: RecordValue,
  definitions: readonly GraphQLArgument[],
  targetsModeration: ModerationTargetLookup,
): Promise<true | string> {
  async function walk(value: unknown, type: GraphQLInputType): Promise<true | string> {
    if (value == null) return true
    if (isNonNullType(type)) return walk(value, type.ofType)
    if (isListType(type)) {
      for (const item of list(value)) {
        const result = await walk(item, type.ofType)
        if (result !== true) return result
      }
      return true
    }
    if (!isInputObjectType(type)) return true
    switch (type.name) {
      case 'ChannelEnabledPluginsFieldInput':
      case 'ChannelEnabledPluginsUpdateFieldInput':
        return validateChannelPluginWrites(value, targetsModeration)
      case 'ChannelEnabledPluginsConnectFieldInput':
        return validateChannelPluginWrites({connect:[value]}, targetsModeration)
      case 'ChannelEnabledPluginsUpdateConnectionInput':
        return validateChannelPluginWrites({update:value}, targetsModeration)
      case 'ChannelEnabledPluginsCreateFieldInput':
      case 'ChannelEnabledPluginsDeleteFieldInput':
        return CHANNEL_GOVERNANCE_WRITE_ERROR
      case 'ChannelEnabledPluginsDisconnectFieldInput':
        return true
    }
    if (/^ChannelEnabledPlugins.*(?:FieldInput|ConnectionInput)$/.test(type.name)) return CHANNEL_GOVERNANCE_WRITE_ERROR
    const input = record(value)
    for (const field of Object.values(type.getFields())) {
      if (!Object.prototype.hasOwnProperty.call(input, field.name)) continue
      const result = await walk(input[field.name], field.type)
      if (result !== true) return result
    }
    return true
  }
  for (const definition of definitions) {
    const result = await walk(args[definition.name], definition.type)
    if (result !== true) return result
  }
  return true
}

const lookupModerationTargets = (driver: Driver): ModerationTargetLookup => async where => {
  const result = await executeGeneratedOperation<{pluginVersions:Array<{id:string}>}>(driver,
    'query GovernedChannelPluginTargets($where:PluginVersionWhere){pluginVersions(where:$where){id}}',
    {where:{AND:[where,{Plugin:{name:{eq:'llm-moderation'}}}]}})
  return result.pluginVersions.length > 0
}

export const createChannelPluginGovernanceRule = (
  lookup: (context: GraphQLContext) => ModerationTargetLookup = context => lookupModerationTargets(context.driver),
) => rule('generatedChannelPluginWritesAreGoverned', {cache:'no_cache'})(
  async (_parent: unknown, args: RecordValue, context: GraphQLContext, info: GraphQLResolveInfo) =>
    validateChannelPluginMutationArguments(args, info.parentType.getFields()[info.fieldName].args, lookup(context))
)

type PermissionRule = Parameters<typeof chain>[number]
/** Authorization stays first. No per-request caching: aliases may carry
 * different input and different root input types within one request. */
export const guardChannelPluginMutationRules = (
  rules: Record<string, PermissionRule>,
  governance = createChannelPluginGovernanceRule(),
): Record<string, PermissionRule> => Object.fromEntries(
  Object.entries(rules).map(([field, authorization]) => [field, chain(authorization, governance)])
)
