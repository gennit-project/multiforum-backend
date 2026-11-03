import type { PluginMutationResolvers, PluginQueryResolvers } from "../../customResolvers/contracts/plugins.js";
import type { PublicAttemptRow, PublicJobRow, DownloadHistoryRow } from "../../services/persistence/pipelineHistoryRepository.js";
import type { DownloadClearedRow } from "../../services/persistence/downloadReviewRepository.js";
import type { Driver } from "neo4j-driver";
import pipelineHistory from "../../customResolvers/queries/getPipelineRuns.js";
import downloadHistory from "../../customResolvers/queries/getPluginRunsForDownloadableFile.js";
import summary from "../../customResolvers/queries/getPluginPipelineSummary.js";
import publicRun from "../../customResolvers/queries/getPublicPluginPipelineRun.js";
import internalRun from "../../customResolvers/queries/getInternalPluginPipelineRun.js";
import secrets from "../../customResolvers/queries/getServerPluginSecrets.js";
import clear from "../../customResolvers/mutations/clearDownloadableFileScan.js";
import review from "../../customResolvers/mutations/requestDownloadableFileReview.js";
import secret from "../../customResolvers/mutations/setServerPluginSecret.js";
import track from "../../customResolvers/mutations/trackDownload.js";
import support from "../../customResolvers/mutations/updateDownloadableFileSupportSettings.js";
declare const driver: Driver;
const queries = {
  getPipelineRuns:pipelineHistory({driver}), getPluginRunsForDownloadableFile:downloadHistory({driver}),
  getPipelineSummary:summary({driver}),getPublicPipelineRun:publicRun({driver}),getInternalPluginPipelineRun:internalRun({driver}),getServerPluginSecrets:secrets({driver}),
} satisfies PluginQueryResolvers;
const mutations = {
  clearDownloadableFileScan:clear({driver}),requestDownloadableFileReview:review({driver}),setServerPluginSecret:secret({driver}),trackDownload:track({driver}),updateDownloadableFileSupportSettings:support({driver}),
} satisfies PluginMutationResolvers;
// @ts-expect-error GraphQL Boolean response cannot be replaced with a string
const wrongBoolean: PluginMutationResolvers["trackDownload"] = async () => "true";
// @ts-expect-error required selected id cannot be omitted
const missingId: PluginQueryResolvers["getPipelineRuns"] = () => [{pluginId:"plugin"}];
// @ts-expect-error selected filename must be a string
const wrongFilename: PluginMutationResolvers["clearDownloadableFileScan"] = () => ({id:"f",fileName:1,scanStatus:null,scanReason:null,scanCheckedAt:null});
declare const attempt: PublicAttemptRow;
declare const job: PublicJobRow;
declare const download: DownloadHistoryRow;
declare const cleared: DownloadClearedRow;
// @ts-expect-error public read does not fetch internal configuration
attempt.configurationSnapshot;
// @ts-expect-error public job projection does not fetch private payload
job.payload;
// @ts-expect-error download history does not fetch pipeline IDs
 download.pipelineId;
// @ts-expect-error cleared download response does not fetch review reason
cleared.reviewRequestReason;
void [queries,mutations,wrongBoolean,missingId,wrongFilename];

// @ts-expect-error arbitrary strings are not SecretValidationStatus values
const wrongSecretStatus: PluginQueryResolvers["getServerPluginSecrets"] = () => [{key:"key",status:"OTHER",lastValidatedAt:null,validationError:null}];
void wrongSecretStatus;
