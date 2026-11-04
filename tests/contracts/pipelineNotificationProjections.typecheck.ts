import type {PipelineNotificationAttempt,PipelineNotificationFile} from '../../customResolvers/contracts/pipelineNotificationProjections.js';
declare const attempt:PipelineNotificationAttempt;
// @ts-expect-error recipient lookup does not select pipeline configuration
void attempt.configurationSnapshot;
// @ts-expect-error selected nullable marker must be present
const missing:PipelineNotificationAttempt={pipelineId:'p',targetId:'t',targetType:'DownloadableFile',status:'SUCCEEDED'};
declare const file:PipelineNotificationFile;
// @ts-expect-error discussion relationship remains nullable
void file.Discussion.Author;
// @ts-expect-error author lookup does not select email
void file.Discussion?.Author?.Email;
// @ts-expect-error returned channels do not contain full channel entities
void file.Discussion?.DiscussionChannels[0].Channel;
void missing;
