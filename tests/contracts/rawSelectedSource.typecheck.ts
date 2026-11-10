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
