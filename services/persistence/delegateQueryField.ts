import {delegateToSchema} from '@graphql-tools/delegate';
import {OperationTypeNode} from 'graphql';
import type {QueryDelegationOptions,QueryField} from '../../customResolvers/contracts/queryDelegation.js';

/** Preserve the delegate's values, errors, selection info and context unchanged.
 * No eager row decoder, full-entity assertion or extra database read is added. */
export function delegateQueryField<K extends QueryField>(options:QueryDelegationOptions<K>):unknown {
 // Forward only the supported contract. Structurally assignable callers may
 // contain extra library options, including result transforms or executors.
 return delegateToSchema({schema:options.schema,fieldName:options.fieldName,
  args:options.args,context:options.context,info:options.info,operation:OperationTypeNode.QUERY});
}
