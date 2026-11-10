import type { DiscussionListFlair, DiscussionListFlairSource } from '../../customResolvers/contracts/discussionListFlairs.js';
import type { RawSelectedListResolver } from '../../customResolvers/contracts/rawSelectedSource.js';
import type { SelectedResolver } from '../../customResolvers/contracts/selection.js';
import type { DiscussionChannelListItemResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
const raw:DiscussionListFlair={id:null,channelUniqueName:17,displayName:['malformed'],color:null,order:'raw',archived:null};
const checked:DiscussionListFlairSource=()=>[raw];
// @ts-expect-error exact source keys cannot silently disappear
const absent:DiscussionListFlair={id:'id'};
// @ts-expect-error source maps are not primitive list items
const scalar:DiscussionListFlairSource=()=>[17];
// @ts-expect-error generated list container remains non-null
const nullList:DiscussionListFlairSource=()=>null;
// @ts-expect-error unknown stored leaves do not prove a completed scalar response
const notAResponse:SelectedResolver<DiscussionChannelListItemResolvers<GraphQLContext>['Flairs'],{id:true}>=checked;
// @ts-expect-error scalar outputs cannot be declared fixed list sources
const notAList:RawSelectedListResolver<()=>string,true>=()=>[];
// @ts-expect-error arbitrary JSON/any cannot establish a list source
const json:RawSelectedListResolver<()=>any,true>=()=>[];
void [raw,checked,absent,scalar,nullList,notAResponse,notAList,json];

import type { RawSelectedSource } from '../../customResolvers/contracts/rawSelectedSource.js';
// @ts-expect-error generated promise wrappers cannot make an item an empty object
const promisedScalar:RawSelectedSource<Promise<{id:string}>,{id:true}>=17;
// @ts-expect-error selecting a field absent from an object cannot become an empty permissive shape
const absentSelection:RawSelectedSource<{other:string},{id:true}>={};
void [promisedScalar,absentSelection];

import type { ScratchpadSuperVoter, ScratchpadSuperVoterSource } from '../../customResolvers/contracts/scratchpadSuperVoters.js';
const rawVoter:ScratchpadSuperVoter={username:null};
const voterList:ScratchpadSuperVoterSource=()=>[rawVoter];
// @ts-expect-error stored usernames have not passed GraphQL String serialization
const validUsername:string=rawVoter.username;
// @ts-expect-error actual map projection always includes the key
const omittedVoterName:ScratchpadSuperVoterSource=()=>[{}];
void [rawVoter,voterList,validUsername,omittedVoterName];

import type {SiteWideDownloadFileSource} from '../../customResolvers/contracts/siteWideDownloadFiles.js';
import type {SiteWideDiscussionSource} from '../../customResolvers/contracts/siteWideDiscussionSources.js';
// @ts-expect-error fixed file maps cannot be arbitrary scalar entries
const invalidFile:SiteWideDownloadFileSource=()=>['file'];
// @ts-expect-error the declared ID key is required even though its stored value is unknown
const missingFileId:SiteWideDownloadFileSource=()=>[{scanStatus:'CLEAN'}];
declare const sitewide:SiteWideDiscussionSource;
// @ts-expect-error arbitrary voter usernames are not validated viewer parameters
const sitewideVoter:string=sitewide.DiscussionChannels[0]!.UpvotedByUsers[0]!.username;
// @ts-expect-error hydration maps have no arbitrary catch-all properties
const unknownSitewideProperty=sitewide.unselected;
void [invalidFile,missingFileId,sitewideVoter,unknownSitewideProperty];

import type {RawSelectedResolver} from '../../customResolvers/contracts/rawSelectedSource.js';
import type {ImageUsageSourceResolver} from '../../customResolvers/contracts/imageUsageSource.js';
import imageUsage from '../../customResolvers/queries/getImageAlbumUsage.js';
import type {Driver} from 'neo4j-driver';
declare const driver:Driver;
const actualImageUsage=imageUsage({driver}) satisfies ImageUsageSourceResolver;
// @ts-expect-error a fixed root projection must include the selected containers
const missingImageContainers:ImageUsageSourceResolver=()=>({imageId:'id'});
// @ts-expect-error nested map declarations cannot omit their selected discussion collection
const missingAlbumChildren:ImageUsageSourceResolver=()=>({imageId:'id',uploaderUsername:null,uploaderOwnedAlbums:[{id:'album'}],otherAlbums:[]});
// @ts-expect-error arbitrary JSON cannot certify a structured root projection
const rawJsonRoot:RawSelectedResolver<()=>any,true>=()=>({});
void [actualImageUsage,missingImageContainers,missingAlbumChildren,rawJsonRoot];

// @ts-expect-error a nested unrestricted JSON value cannot certify an object-shaped selection
const structuredNestedJson:RawSelectedSource<{payload:any},{payload:{id:true}}>={payload:{id:'x'}};
void structuredNestedJson;

// Fixed root projections must include selected nullable keys, not only non-null ones.
// @ts-expect-error a nullable selected key cannot vanish from an owned fixed projection
const missingNullableRoot:RawSelectedResolver<()=>{id:string;title?:string|null},{id:true;title:true}>=()=>({id:'id'});
// @ts-expect-error fixed nested selections also retain their nullable keys
const missingNullableChild:RawSelectedResolver<()=>{child:{id:string;title?:string|null}},{child:{id:true;title:true}}>=()=>({child:{id:'id'}});
const explicitRawNull:RawSelectedResolver<()=>{title?:string|null},{title:true}>=()=>({title:null});
const explicitRawUndefined:RawSelectedResolver<()=>{title?:string|null},{title:true}>=()=>({title:undefined});
void [missingNullableRoot,missingNullableChild,explicitRawNull,explicitRawUndefined];
// @ts-expect-error fixed list items cannot omit a selected nullable property
const missingNullableListItem:RawSelectedResolver<()=>{items:{title?:string|null}[]},{items:{title:true}}>=()=>({items:[{}]});
const nullableFixedRoot:RawSelectedResolver<()=>{title?:string|null}|null,{title:true}>=()=>null;
void [missingNullableListItem,nullableFixedRoot];
