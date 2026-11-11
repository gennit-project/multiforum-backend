import type {RawSelectedResolver} from './rawSelectedSource.js';
import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
export const imageWriteSourceSelection={id:true,createdAt:true,Uploader:{username:true},Albums:{id:true}} as const;
export const imageWriteSourceMutationNames=['createImageWithUploader'] as const;
export type ImageWriteSourceMutationResolvers={createImageWithUploader:SelectedResolver<MutationResolvers<GraphQLContext>['createImageWithUploader'],typeof imageWriteSourceSelection> & RawSelectedResolver<MutationResolvers<GraphQLContext>['createImageWithUploader'],typeof imageWriteSourceSelection>};
