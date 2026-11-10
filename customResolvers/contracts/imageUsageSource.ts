import type {ImageAlbumUsage,QueryResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {Selection} from './selection.js';
import type {RawSelectedResolver} from './rawSelectedSource.js';
const identity={username:true,displayName:true} as const;
const discussion={id:true,title:true,createdAt:true,Author:identity,
 DiscussionChannels:{id:true,channelUniqueName:true}} as const;
const album={id:true,imageOrder:true,Owner:identity,Discussions:discussion} as const;
export const imageUsageSourceSelection={imageId:true,uploaderUsername:true,
 uploaderOwnedAlbums:album,otherAlbums:album} as const satisfies Selection<ImageAlbumUsage>;
export type ImageUsageSourceResolver=RawSelectedResolver<QueryResolvers<GraphQLContext>['getImageAlbumUsage'],typeof imageUsageSourceSelection>;
