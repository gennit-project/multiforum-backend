import type {CommentTriggerArgs} from "../../services/plugin/types.js";
import type {CommentExecutionRepository} from "../../services/persistence/commentExecutionRepository.js";
import {CHANNEL_SELECTION,COMMENT_SELECTION,CONFIGURATION_SELECTION,RETURNED_RUN_SELECTION,SECRET_SELECTION} from "../../services/persistence/commentExecutionRepository.js";
// Original model operations retained only for characterization tests.
export function commentExecutionRepositoryStub(models:CommentTriggerArgs['models']):CommentExecutionRepository {
 return {
 findChannel:uniqueName=>models.Channel.find({where:{uniqueName},selectionSet:CHANNEL_SELECTION}),
 findComment:id=>models.Comment.find({where:{id},selectionSet:COMMENT_SELECTION}),
 findConfiguration:()=>models.ServerConfig.find({selectionSet:CONFIGURATION_SELECTION}),
 createPendingRuns:input=>models.PluginRun.create({input}),
 markSkippedRun:async(id,update)=>{await models.PluginRun.update({where:{id},update});},
 findReturnedRun:id=>models.PluginRun.find({where:{id},selectionSet:RETURNED_RUN_SELECTION}),
 findSecrets:pluginId=>models.ServerSecret.find({where:{pluginId},selectionSet:SECRET_SELECTION}),
 };
}
