import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Kind,parse,type SelectionSetNode} from 'graphql';
import * as projections from '../customResolvers/contracts/pluginExecutionProjections.js';
import * as downloadExecutionRepository from '../services/persistence/downloadExecutionRepository.js';
import * as pipelineLeaseRepository from '../services/persistence/pipelineLeaseRepository.js';
import * as pipelineRerunRepository from '../services/persistence/pipelineRerunRepository.js';
import * as pipelineRetryRepository from '../services/persistence/pipelineRetryRepository.js';
import * as pipelineStartRepository from '../services/persistence/pipelineStartRepository.js';
function shape(set:SelectionSetNode):Record<string,unknown>{return Object.fromEntries(set.selections.map(field=>{assert.equal(field.kind,Kind.FIELD);if(field.kind!==Kind.FIELD)throw Error('Unexpected fragment');assert.equal(field.alias,undefined,'fixed canonical selections cannot contain response-key aliases');return [field.name.value,field.selectionSet?shape(field.selectionSet):true];}));}
const selections=[
['rerunSourceSelection',pipelineRerunRepository.RERUN_SELECTION_0,projections.rerunSourceSelection],
['fileVersionSelection',pipelineRerunRepository.RERUN_SELECTION_1,projections.fileVersionSelection],
['rerunRelatedSelection',pipelineRerunRepository.RERUN_SELECTION_3,projections.rerunRelatedSelection],
['startFileSelection',pipelineStartRepository.START_SELECTION_0,projections.startFileSelection],
['startChannelSelection',pipelineStartRepository.START_SELECTION_2,projections.startChannelSelection],
['startServerSelection',pipelineStartRepository.START_SELECTION_3,projections.startServerSelection],
['activeAttemptSelection',pipelineStartRepository.START_SELECTION_4,projections.activeAttemptSelection],
['startedAttemptSelection',pipelineStartRepository.START_SELECTION_5,projections.startedAttemptSelection],
['retryTargetSelection',pipelineRetryRepository.RETRY_SELECTION_0,projections.retryTargetSelection],
['retryFailedSelection',pipelineRetryRepository.RETRY_SELECTION_1,projections.retryFailedSelection],
['returnedJobSelection',pipelineRetryRepository.RETRY_SELECTION_2,projections.returnedJobSelection],
['downloadTriggerFileSelection',downloadExecutionRepository.FILE_SELECTION,projections.downloadTriggerFileSelection],
['downloadTriggerConfigSelection',downloadExecutionRepository.CONFIGURATION_SELECTION,projections.downloadTriggerConfigSelection],
['downloadTriggerSecretSelection',downloadExecutionRepository.SECRET_SELECTION,projections.downloadTriggerSecretSelection],
['pendingJobSelection',pipelineLeaseRepository.PLUGIN_RUN_DEFAULT_SELECTION,projections.pendingJobSelection],
['returned download job',downloadExecutionRepository.RETURNED_RUN_SELECTION,projections.returnedJobSelection],
] as const;
for(const [name,source,expected] of selections)test(`${name} matches generated-operation selection`,()=>{const operation=parse(source).definitions[0];assert.equal(operation.kind,Kind.OPERATION_DEFINITION);if(operation.kind!==Kind.OPERATION_DEFINITION)throw Error('Expected operation');assert.deepEqual(shape(operation.selectionSet),expected);});
