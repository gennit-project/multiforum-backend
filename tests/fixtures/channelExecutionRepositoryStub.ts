import type {ChannelTriggerArgs} from "../../services/plugin/types.js";
import type {ChannelExecutionRepository} from "../../services/persistence/channelExecutionRepository.js";
import {CHANNEL_SELECTION,DISCUSSION_SELECTION,CONFIGURATION_SELECTION,RETURNED_RUN_SELECTION,SECRET_SELECTION} from "../../services/persistence/channelExecutionRepository.js";
// Original model operations retained only for characterization tests.
export function channelExecutionRepositoryStub(models:ChannelTriggerArgs['models']):ChannelExecutionRepository {
 return {
 findChannel:uniqueName=>models.Channel.find({where:{uniqueName},selectionSet:CHANNEL_SELECTION}),
 findDiscussion:id=>models.Discussion.find({where:{id},selectionSet:DISCUSSION_SELECTION}),
 findConfiguration:()=>models.ServerConfig.find({selectionSet:CONFIGURATION_SELECTION}),
 writeScanState:async(id,update)=>{await models.DownloadableFile.update({where:{id},update});},
 createPendingRuns:input=>models.PluginRun.create({input}),
 markSkippedRun:async(id,update)=>{await models.PluginRun.update({where:{id},update});},
 findReturnedRun:id=>models.PluginRun.find({where:{id},selectionSet:RETURNED_RUN_SELECTION}),
 findSecrets:pluginId=>models.ServerSecret.find({where:{pluginId},selectionSet:SECRET_SELECTION}),
 };
}
