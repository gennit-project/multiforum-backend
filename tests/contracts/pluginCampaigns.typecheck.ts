import type {Driver} from 'neo4j-driver';
import {createPluginPipelineCampaign,pausePluginPipelineCampaign,resumePluginPipelineCampaign} from '../../customResolvers/mutations/pluginPipelineCampaigns.js';
import {getPluginPipelineCampaigns,getPluginPipelineCampaignFailures,previewPluginPipelineCampaign} from '../../customResolvers/queries/pluginPipelineCampaigns.js';
import type {PluginCampaignMutationResolvers,PluginCampaignQueryResolvers} from '../../customResolvers/contracts/pluginCampaigns.js';
import type {CampaignRow,CampaignFileRow} from '../../services/persistence/campaignServiceRepository.js';
import type {CampaignStatusRow} from '../../services/persistence/campaignControlRepository.js';
import type {CampaignDestinationRow} from '../../services/persistence/campaignQueryRepository.js';
declare const driver:Driver;
const mutations={createPluginPipelineCampaign:createPluginPipelineCampaign({driver})} satisfies PluginCampaignMutationResolvers;
const queries={getPluginPipelineCampaigns:getPluginPipelineCampaigns({driver}),getPluginPipelineCampaignFailures:getPluginPipelineCampaignFailures({driver}),previewPluginPipelineCampaign:previewPluginPipelineCampaign({driver})} satisfies PluginCampaignQueryResolvers;
declare const row:CampaignRow;
// @ts-expect-error unknown status is not a generated enum
const status:CampaignRow={...row,status:'OTHER'};
// @ts-expect-error nullable timestamp key remains selected
const missing:CampaignRow={id:'campaign'};
// @ts-expect-error scalar counts remain numeric
const count:CampaignRow={...row,runningCount:'0'};
declare const file:CampaignFileRow;
// @ts-expect-error unrelated properties are not fetched
file.fileName;
declare const narrow:CampaignStatusRow;
// @ts-expect-error status lookup does not fetch counters
narrow.runningCount;
// @ts-expect-error relationship child selection requires channelUniqueName
const destination:CampaignDestinationRow={id:'file',Discussion:{id:'discussion',DiscussionChannels:[{archived:false}]}};
void [mutations,queries,status,missing,count,destination];

import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from '../../customResolvers/contracts/selection.js';
import type {campaignSelection} from '../../customResolvers/contracts/pluginCampaigns.js';
// @ts-expect-error concurrent deletion can leave no row for a non-null root
const pause:SelectedResolver<MutationResolvers<GraphQLContext>['pausePluginPipelineCampaign'],typeof campaignSelection>=pausePluginPipelineCampaign({driver});
// @ts-expect-error concurrent deletion can leave no row for a non-null root
const resume:SelectedResolver<MutationResolvers<GraphQLContext>['resumePluginPipelineCampaign'],typeof campaignSelection>=resumePluginPipelineCampaign({driver});
void [pause,resume];
