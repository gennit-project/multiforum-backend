import type {ForumMembershipChannel,ForumMembershipWriteResult} from '../../customResolvers/contracts/forumMembershipSource.js';
import {forumMembershipChannel} from '../helpers/forumMembershipSource.js';
const value=forumMembershipChannel();
const complete:ForumMembershipWriteResult={channels:[value]};
// @ts-expect-error fixed selected item keys cannot disappear
const missing:ForumMembershipWriteResult={channels:[{uniqueName:'cats'}]};
// @ts-expect-error completed booleans cannot remain raw numbers
const locked:ForumMembershipChannel={...value,locked:1};
// @ts-expect-error the required completed timestamp is textual
const date:ForumMembershipChannel={...value,createdAt:new Date()};
// @ts-expect-error JSON structure is deliberately unknown
const pipelines:Record<string,string>=value.pluginPipelines;
// @ts-expect-error the fixed write selection does not project relationships
const admins=value.Admins;
const {displayName,...withoutNullableKey}=value;
// @ts-expect-error nullable selected keys still exist in completed GraphQL data
const absentNullable:ForumMembershipChannel=withoutNullableKey;
void [complete,missing,locked,date,pipelines,admins,displayName,absentNullable];
