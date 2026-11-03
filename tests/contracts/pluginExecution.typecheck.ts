import {createStartPluginPipelineResolver} from '../../customResolvers/mutations/startPluginPipeline.js';
import {createRerunPluginPipelineResolver} from '../../customResolvers/mutations/rerunPluginPipeline.js';
import {createRetryDownloadableFileScanResolver} from '../../customResolvers/mutations/retryDownloadableFileScan.js';
import trigger from '../../customResolvers/mutations/triggerDownloadableFilePluginRuns.js';
import type {PluginExecutionMutationResolvers} from '../../customResolvers/contracts/pluginExecution.js';
import type {StartedAttempt,ReturnedJob,StartFileTarget,ActiveAttempt} from '../../customResolvers/contracts/pluginExecutionProjections.js';
const contracts={startPluginPipeline:createStartPluginPipelineResolver({}),rerunPluginPipeline:createRerunPluginPipelineResolver({}),retryDownloadableFileScan:createRetryDownloadableFileScanResolver({}),triggerDownloadableFilePluginRuns:trigger({})} satisfies PluginExecutionMutationResolvers;
declare const attempt:StartedAttempt;
declare const job:ReturnedJob;
// @ts-expect-error enum output must be generated-compatible
const status:StartedAttempt={...attempt,status:'OTHER'};
// @ts-expect-error selected nullable keys cannot disappear
const missing:ReturnedJob={id:'job'};
// @ts-expect-error count output is numeric
const order:ReturnedJob={...job,executionOrder:'1'};
declare const file:StartFileTarget;
// @ts-expect-error full entity is not selected
file.fileName;
declare const active:ActiveAttempt;
// @ts-expect-error active lookup selects only pipelineId
active.status;
void [contracts,status,missing,order];
// @ts-expect-error non-null attempt cannot return an absent read result
const absent:PluginExecutionMutationResolvers['startPluginPipeline']=async()=>undefined;
// @ts-expect-error jobs cannot be arbitrary provider payloads
const arbitrary:PluginExecutionMutationResolvers['triggerDownloadableFilePluginRuns']=async()=>['raw'];
void [absent,arbitrary];

// #442 uses exact supported plural selections, including revision hash inputs.
declare const startDiscussion: import("../../customResolvers/contracts/pluginExecutionProjections.js").StartDiscussionTarget;
declare const rerunDiscussion: import("../../customResolvers/contracts/pluginExecutionProjections.js").RerunDiscussionVersion;
const discussionTitle: string | null = startDiscussion.title;
const attachmentVersion = rerunDiscussion.DownloadableFiles[0]?.uploadedAt;
// @ts-expect-error obsolete singular relationship is not selected or schema-supported
const singular = startDiscussion.DownloadableFile;
// @ts-expect-error reread does not select author or arbitrary full Discussion fields
const unselectedAuthor = rerunDiscussion.Author;
void [discussionTitle,attachmentVersion,singular,unselectedAuthor];
