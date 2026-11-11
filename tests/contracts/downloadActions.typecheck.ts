// Compile-only selected contracts and exact persistence result shapes.
import type { DownloadActionMutationResolvers, PreparedDownload } from "../../customResolvers/contracts/downloadActions.js";
import type { DownloadLabelChannel, DownloadLabelResult, DownloadLabelOption } from "../../services/persistence/downloadLabelRepository.js";
import type { DownloadPreparationRow } from "../../services/persistence/downloadReviewRepository.js";
import prepareDownload from "../../customResolvers/mutations/prepareDownload.js";
import updateDownloadLabels from "../../customResolvers/mutations/updateDownloadLabels.js";
declare const prepare: ReturnType<typeof prepareDownload>;
declare const labels: ReturnType<typeof updateDownloadLabels>;
const checked: DownloadActionMutationResolvers = {prepareDownload:prepare,updateDownloadLabels:labels};
const blocked: PreparedDownload = {ready:false,url:null,scanStatus:"FAILED",scanReason:null,scanCheckedAt:null,reviewAccess:false,message:"Blocked"};
// @ts-expect-error invalid persisted enum cannot become a prepared response
const badStatus: PreparedDownload = {...blocked,scanStatus:"UNKNOWN"};
// @ts-expect-error mandatory readiness cannot be a nullable/string value
const badReady: PreparedDownload = {...blocked,ready:"false"};
// @ts-expect-error message is required even for blocked responses
const missingMessage: PreparedDownload = {ready:false,url:null,scanStatus:"FAILED",scanReason:null,scanCheckedAt:null,reviewAccess:false};
const channel: DownloadLabelChannel = {id:"dc",LabelOptions:[]};
// @ts-expect-error label output must include order and group projection
const missingOutput: DownloadLabelResult = {id:"dc",LabelOptions:[{id:"l",value:"v",displayName:"Label"}]};
// @ts-expect-error outer selected list cannot be null
const nullList: DownloadLabelChannel = {id:"dc",LabelOptions:null};
// @ts-expect-error label validation query does not fetch ordering
const unfetched = (option: DownloadLabelOption) => option.order;
// @ts-expect-error preparation does not fetch full discussion title
const noDiscussionTitle = (file: DownloadPreparationRow) => file.Discussion?.title;
// @ts-expect-error raw date objects cannot hide behind the custom scalar's any mapping
const invalidTime = (file: DownloadPreparationRow): DownloadPreparationRow => ({...file,scanCheckedAt:{year:2026}});
void [checked,badStatus,badReady,missingMessage,channel,missingOutput,nullList,unfetched,noDiscussionTitle,invalidTime];
