import assert from 'node:assert/strict';
import test from 'node:test';
import type {Driver} from 'neo4j-driver';
import {createPipelineSummaryPage, createPipelineRunPage} from './getPluginPipelinePage.js';
import type {PipelineSummaryPageRepository} from '../../services/persistence/pipelineSummaryPageRepository.js';
import type {PipelineTargetRepository} from '../../services/persistence/pipelineTargetRepository.js';

test('hidden targets prevent all summary reads and detail job/status reads', async () => {
  const called: string[] = [];
  const repository: PipelineSummaryPageRepository = {
    findAttempts: async()=>{called.push('attempts'); return [];},
    findFlags: async()=>{called.push('flags');return {hasActiveWork:false,hasFailedWork:false};},
    findJobs: async()=>{called.push('jobs');return new Map();},
    findAttempt: async()=>({id:'a',pipelineId:'p',targetId:'file',targetType:'DownloadableFile',scope:'SERVER',eventType:'created',status:'SUCCEEDED',trigger:'EVENT',attemptNumber:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}),
  };
  const target = {findDownloadVisibility:async()=>[]} as unknown as PipelineTargetRepository;
  const deps = {driver:{} as Driver,repository,pipelineTargetRepository:target};
  await assert.rejects(createPipelineSummaryPage(deps)(null,{targetId:'file',targetType:'DownloadableFile'}), /Pipeline target not found/);
  await assert.rejects(createPipelineRunPage(deps)(null,{pipelineRunId:'a'}), /Pipeline target not found/);
  assert.deepEqual(called, []);
});
