import { hasServerPermission } from '../../rules/permission/hasServerPermission.js'
import type { GraphQLContext } from '../../types/context.js'
export const createPluginManagementCapabilityResolver = (check = hasServerPermission) =>
  async (_parent: unknown, _args: unknown, context: GraphQLContext): Promise<boolean> =>
    (await check('canManagePlugins', context, { readOnly: true })) === true
