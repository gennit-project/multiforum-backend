import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Kind,parse,type SelectionSetNode} from 'graphql';
import * as projections from '../customResolvers/contracts/pluginInstallationProjections.js';
import * as installation from '../services/persistence/pluginInstallRepository.js';
import * as registry from '../services/persistence/pluginRegistryRepository.js';
import * as enablement from '../services/persistence/serverPluginEnablementRepository.js';
function shape(selection:SelectionSetNode):Record<string,unknown>{return Object.fromEntries(selection.selections.map(field=>{assert.equal(field.kind,Kind.FIELD);if(field.kind!==Kind.FIELD)throw new Error('Unexpected fragment');return [field.name.value,field.selectionSet?shape(field.selectionSet):true];}));}
for(const [name,expected] of Object.entries(projections))test(`${name} matches actual executable schema projection`,()=>{
 const constant=name.replace(/Selection$/,'_SELECTION');
 const entry=Object.entries({...installation,...registry,...enablement}).find(([key])=>key===constant);assert.ok(entry);assert.equal(typeof entry[1],'string');
 const operation=parse('query '+entry[1]).definitions[0];assert.equal(operation.kind,Kind.OPERATION_DEFINITION);if(operation.kind!==Kind.OPERATION_DEFINITION)throw new Error('Expected operation');
 let selection=operation.selectionSet;const first=selection.selections[0];if(first.kind===Kind.FIELD&&['plugins','pluginVersions','serverConfigs'].includes(first.name.value)){assert.ok(first.selectionSet);selection=first.selectionSet;}
 assert.deepEqual(shape(selection),expected);
});
