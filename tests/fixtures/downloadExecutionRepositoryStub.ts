import type {TriggerArgs} from "../../services/plugin/types.js";
import type {DownloadExecutionRepository} from "../../services/persistence/downloadExecutionRepository.js";
import {FILE_SELECTION,CONFIGURATION_SELECTION,RETURNED_RUN_SELECTION,SECRET_SELECTION} from "../../services/persistence/downloadExecutionRepository.js";
// Original model operations retained only for characterization tests.
export function downloadExecutionRepositoryStub(models:TriggerArgs['models']):DownloadExecutionRepository {
 return {
 findFile:id=>models.DownloadableFile.find({where:{id},selectionSet:FILE_SELECTION}),
 findConfiguration:()=>models.ServerConfig.find({selectionSet:CONFIGURATION_SELECTION}),
 writeScanState:async(id,update)=>{await models.DownloadableFile.update({where:{id},update});},
 createPendingRuns:input=>models.PluginRun.create({input}),
 markSkippedRun:async(id,update)=>{await models.PluginRun.update({where:{id},update});},
 findReturnedRun:id=>models.PluginRun.find({where:{id},selectionSet:RETURNED_RUN_SELECTION}),
 findSecrets:pluginId=>models.ServerSecret.find({where:{pluginId},selectionSet:SECRET_SELECTION}),
 };
}
