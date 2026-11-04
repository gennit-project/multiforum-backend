import type {Driver} from 'neo4j-driver';
import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from '../../customResolvers/contracts/selection.js';
import shareCollection from '../../customResolvers/mutations/shareCollectionAsDiscussion.js';
declare const driver:Driver;
// @ts-expect-error array cardinality is not yet encoded; wrapper explicitly retains possible undefined rather than relying on unchecked indexing
const unresolved:SelectedResolver<MutationResolvers<GraphQLContext>['shareCollectionAsDiscussion'],{id:true}> = shareCollection({driver});
void unresolved;
