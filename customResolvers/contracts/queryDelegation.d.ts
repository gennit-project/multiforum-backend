import type {GraphQLResolveInfo,GraphQLSchema} from 'graphql';
import type {QueryResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';

type Callable<R> = Extract<NonNullable<R>, (...args:never[])=>unknown>;
export type QueryField = Exclude<keyof QueryResolvers<GraphQLContext>, `__${string}`>;
type QueryArgs<K extends QueryField> = Parameters<Callable<QueryResolvers<GraphQLContext>[K]>>[1];
/** Only the query name and generated arguments are certified here. Delegated
 * values retain library error/selection semantics and are deliberately unknown. */
export type QueryDelegationOptions<K extends QueryField> = {
 schema:GraphQLSchema;
 fieldName:K;
 args:NoInfer<QueryArgs<K>>;
 context:Record<string,unknown>;
 info:GraphQLResolveInfo;
};
