import type {QueryResolvers,WikiPage} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {Selection} from './selection.js';
import type {RawSelectedResolver} from './rawSelectedSource.js';
export const wikiListItemSelection={
 id:true,title:true,body:true,slug:true,channelUniqueName:true,createdAt:true,updatedAt:true,
 VersionAuthor:{username:true,displayName:true,profilePicURL:true},
} as const satisfies Selection<WikiPage>;
export type WikiListSource=RawSelectedResolver<QueryResolvers<GraphQLContext>['getSiteWideWikiList'],{
 wikiPages:typeof wikiListItemSelection;featuredWikiPages:typeof wikiListItemSelection;
}>;
