import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
export const imageWriteSourceSelection={id:true,createdAt:true} as const;
export const imageWriteSourceMutationNames=['createImageWithUploader'] as const;
export type ImageWriteSourceMutationResolvers={createImageWithUploader:SelectedResolver<MutationResolvers<GraphQLContext>['createImageWithUploader'],typeof imageWriteSourceSelection>};
