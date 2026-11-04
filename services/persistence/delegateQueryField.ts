import {delegateToSchema} from '@graphql-tools/delegate';
import {OperationTypeNode} from 'graphql';
import type {QueryDelegationOptions,QueryField} from '../../customResolvers/contracts/queryDelegation.js';

/** Preserve the delegate's values, errors, selection info and context unchanged.
 * No eager row decoder, full-entity assertion or extra database read is added. */
export function delegateQueryField<K extends QueryField>(options:QueryDelegationOptions<K>):unknown {
 return delegateToSchema({...options,operation:OperationTypeNode.QUERY});
}
