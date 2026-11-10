import type {ConfigurationApplyResponse} from './pluginConfiguration.js';
import type {PluginConfigStatus} from '../../services/plugin/configStatus.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';
export function reconciliationPlanSource(plan:ConfigurationApplyResponse['planBefore']) {
 return rememberCanonicalSource({apiVersion:plan.apiVersion,inSync:plan.inSync,warnings:plan.warnings,
  changes:plan.changes.map(change=>rememberCanonicalSource({kind:change.kind,path:change.path,message:change.message,current:change.current,desired:change.desired,blocked:change.blocked})),
 });
}
export function configurationApplySource(result:ConfigurationApplyResponse):ConfigurationApplyResponse {
 return rememberCanonicalSource({status:result.status,message:result.message,planBefore:reconciliationPlanSource(result.planBefore),planAfter:reconciliationPlanSource(result.planAfter),
  operations:result.operations.map(operation=>rememberCanonicalSource({kind:operation.kind,path:operation.path,status:operation.status,message:operation.message})),
 });
}
export function pluginConfigStatusSource(status:PluginConfigStatus):PluginConfigStatus {
 return rememberCanonicalSource({isFullyConfigured:status.isFullyConfigured,
  fields:status.fields.map(field=>rememberCanonicalSource({key:field.key,label:field.label,scope:field.scope,kind:field.kind,required:field.required,isSet:field.isSet,isValid:field.isValid,message:field.message})),
 });
}
