import type {Driver} from 'neo4j-driver';
import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from '../../customResolvers/contracts/selection.js';
import shareCollection from '../../customResolvers/mutations/shareCollectionAsDiscussion.js';
declare const driver:Driver;
// @ts-expect-error post-commit refetch can return undefined; even identity-only output cannot claim the non-null root contract
const unresolved:SelectedResolver<MutationResolvers<GraphQLContext>['shareCollectionAsDiscussion'],{id:true}> = shareCollection({driver});
void unresolved;
