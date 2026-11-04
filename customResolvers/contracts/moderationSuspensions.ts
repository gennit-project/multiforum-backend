import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
export const moderationSuspensionSelection={id:true,isOpen:true} as const;
export const moderationSuspensionMutationNames=["suspendUser", "suspendMod", "unsuspendUser", "unsuspendMod"] as const;
export type ModerationSuspensionMutationResolvers={
 suspendUser:SelectedResolver<MutationResolvers<GraphQLContext>['suspendUser'],typeof moderationSuspensionSelection>;
 suspendMod:SelectedResolver<MutationResolvers<GraphQLContext>['suspendMod'],typeof moderationSuspensionSelection>;
 unsuspendUser:SelectedResolver<MutationResolvers<GraphQLContext>['unsuspendUser'],typeof moderationSuspensionSelection>;
 unsuspendMod:SelectedResolver<MutationResolvers<GraphQLContext>['unsuspendMod'],typeof moderationSuspensionSelection>;
};
