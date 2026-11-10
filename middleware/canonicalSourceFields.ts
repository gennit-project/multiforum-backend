import type {GraphQLResolveInfo} from 'graphql';
import {hasCanonicalSourceFields} from '../services/canonicalSourceFields.js';

/** Keep canonical owned maps distinct from generated response-key projections.
 * Only the resolver's field-node view changes; paths, arguments, selection sets,
 * context, the parent object and GraphQL's original completion stay unchanged.
 */
export async function resolveCanonicalSourceField<Context>(
  resolve: (parent: unknown, args: Record<string, unknown>, context: Context, info: GraphQLResolveInfo) => unknown,
  parent: unknown,
  args: Record<string, unknown>,
  context: Context,
  info: GraphQLResolveInfo,
): Promise<unknown> {
  if (!hasCanonicalSourceFields(parent)) return resolve(parent, args, context, info);
  const fieldNodes = info.fieldNodes.map(node => ({...node, alias: undefined}));
  return resolve(parent, args, context, {...info, fieldNodes});
}
