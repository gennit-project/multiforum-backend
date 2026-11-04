import type {PipelineAttemptPayload,PipelineJobPayload,PipelineAttemptNumber} from '../../customResolvers/contracts/pipelineLifecycleProjections.js';
// @ts-expect-error the number query always selects attemptNumber
const incomplete:PipelineAttemptNumber={};
declare const attempt:PipelineAttemptPayload;
declare const job:PipelineJobPayload;
// @ts-expect-error no create/update info selection
void attempt.info;
// @ts-expect-error no create/update info selection
void job.info;
// @ts-expect-error default job selection does not include deferred scheduling flag
void job.pluginRuns[0].deferred;
// @ts-expect-error selected nullable campaign field must be present
const missingCampaign:typeof attempt.pluginPipelineRuns[number]={id:'attempt'};
void [incomplete,missingCampaign];
