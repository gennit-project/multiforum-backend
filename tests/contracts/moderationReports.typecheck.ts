import type {Driver} from 'neo4j-driver';
import reportComment from '../../customResolvers/mutations/reportComment.js';
import reportDiscussion from '../../customResolvers/mutations/reportDiscussion.js';
import reportEvent from '../../customResolvers/mutations/reportEvent.js';
import reportChannel from '../../customResolvers/mutations/reportChannel.js';
import reportImage from '../../customResolvers/mutations/reportImage.js';
import reportProfilePicture from '../../customResolvers/mutations/reportProfilePicture.js';
import reportChannelImage from '../../customResolvers/mutations/reportChannelImage.js';
import reportWikiEdit from '../../customResolvers/mutations/reportWikiEdit.js';
import type {ModerationReportMutationResolvers} from '../../customResolvers/contracts/moderationReports.js';
import {appendModerationActions} from '../../services/persistence/moderationIssueWrites.js';
import type {ModerationIssueRow,ReportModerationIssueRow} from '../../services/persistence/moderationIssueWrites.js';
declare const driver:Driver;
const contracts={reportComment:reportComment({driver}),reportDiscussion:reportDiscussion({driver}),reportEvent:reportEvent({driver}),reportChannel:reportChannel({driver}),reportImage:reportImage({driver}),reportProfilePicture:reportProfilePicture({driver}),reportChannelImage:reportChannelImage({driver}),reportWikiEdit:reportWikiEdit({driver})} satisfies ModerationReportMutationResolvers;

declare const report:ReportModerationIssueRow;
// @ts-expect-error unrelated persisted fields remain unknown
const body:string=report.body;
// @ts-expect-error no unchecked full entity issueNumber promise
const number:number=report.issueNumber;
// @ts-expect-error generated selected flag is boolean
const bad:ReportModerationIssueRow={id:'i',isOpen:'true',flaggedServerRuleViolation:false};
// @ts-expect-error missing flag cannot masquerade as a selected report result
const missing:ReportModerationIssueRow={id:'i',isOpen:true};
const unchanged=appendModerationActions(driver,{issueId:'i',actions:[]});
const closed=appendModerationActions(driver,{issueId:'i',actions:[],isOpen:false});
async function check(){
 const raw=(await unchanged).issues[0];
 // @ts-expect-error omitted isOpen leaves persisted value unknown
 const bool:boolean=raw.isOpen;
 const narrow=(await closed).issues[0];
 const verified:boolean=narrow.isOpen;
 // @ts-expect-error omitted flag remains unknown
 const flag:boolean=narrow.flaggedServerRuleViolation;
 return [bool,verified,flag];
}
void [contracts,body,number,bad,missing,check];
