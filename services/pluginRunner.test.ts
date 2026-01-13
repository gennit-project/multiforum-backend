import assert from "node:assert/strict";
import {
  shouldRunStep,
  generatePipelineId,
  isSupportedEvent,
  isChannelEvent,
  type PipelineStep
} from "./pluginRunner.js";

// Tests for shouldRunStep function

async function testShouldRunStepAlwaysCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'ALWAYS' };

  // ALWAYS should run regardless of previous status
  assert.equal(shouldRunStep(step, null), true, "ALWAYS should run when no previous step");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "ALWAYS should run after success");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "ALWAYS should run after failure");
}

async function testShouldRunStepPreviousSucceededCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'PREVIOUS_SUCCEEDED' };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_SUCCEEDED should not run when no previous step");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "PREVIOUS_SUCCEEDED should run after success");
  assert.equal(shouldRunStep(step, 'FAILED'), false, "PREVIOUS_SUCCEEDED should not run after failure");
}

async function testShouldRunStepPreviousFailedCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'PREVIOUS_FAILED' };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_FAILED should not run when no previous step");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), false, "PREVIOUS_FAILED should not run after success");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "PREVIOUS_FAILED should run after failure");
}

async function testShouldRunStepDefaultsToAlways() {
  // When condition is not specified, it defaults to ALWAYS
  const step: PipelineStep = { pluginId: 'test-plugin' };

  assert.equal(shouldRunStep(step, null), true, "Default should run when no previous step");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "Default should run after success");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "Default should run after failure");
}

// Tests for generatePipelineId function

async function testGeneratePipelineIdFormat() {
  const id = generatePipelineId();

  assert.ok(id.startsWith('pipeline-'), "Pipeline ID should start with 'pipeline-'");
  assert.ok(id.length > 20, "Pipeline ID should have sufficient length");
}

async function testGeneratePipelineIdUniqueness() {
  const ids = new Set<string>();

  for (let i = 0; i < 100; i++) {
    ids.add(generatePipelineId());
  }

  assert.equal(ids.size, 100, "Generated pipeline IDs should be unique");
}

// Tests for isSupportedEvent function

async function testIsSupportedEventDownloadEvents() {
  // Server-scoped download events
  assert.equal(isSupportedEvent('downloadableFile.created'), true, "downloadableFile.created should be supported");
  assert.equal(isSupportedEvent('downloadableFile.updated'), true, "downloadableFile.updated should be supported");
  assert.equal(isSupportedEvent('downloadableFile.downloaded'), true, "downloadableFile.downloaded should be supported");
}

async function testIsSupportedEventRejectsInvalidEvents() {
  assert.equal(isSupportedEvent('unknown.event'), false, "Unknown event should not be supported");
  assert.equal(isSupportedEvent('discussionChannel.created'), false, "Channel event should not be in server events");
  assert.equal(isSupportedEvent(''), false, "Empty string should not be supported");
}

// Tests for isChannelEvent function

async function testIsChannelEventChannelEvents() {
  assert.equal(isChannelEvent('discussionChannel.created'), true, "discussionChannel.created should be channel event");
}

async function testIsChannelEventRejectsServerEvents() {
  assert.equal(isChannelEvent('downloadableFile.created'), false, "downloadableFile.created is not a channel event");
  assert.equal(isChannelEvent('downloadableFile.updated'), false, "downloadableFile.updated is not a channel event");
  assert.equal(isChannelEvent('unknown.event'), false, "Unknown event is not a channel event");
}

// Tests for step conditions with continueOnError

async function testStepWithContinueOnError() {
  const step: PipelineStep = {
    pluginId: 'test-plugin',
    condition: 'ALWAYS',
    continueOnError: true
  };

  // continueOnError doesn't affect shouldRunStep - it affects pipeline behavior after execution
  assert.equal(shouldRunStep(step, null), true, "Step with continueOnError should still run");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "Step with continueOnError should run after failure");
}

// Run all tests
async function run() {
  await testShouldRunStepAlwaysCondition();
  await testShouldRunStepPreviousSucceededCondition();
  await testShouldRunStepPreviousFailedCondition();
  await testShouldRunStepDefaultsToAlways();
  await testGeneratePipelineIdFormat();
  await testGeneratePipelineIdUniqueness();
  await testIsSupportedEventDownloadEvents();
  await testIsSupportedEventRejectsInvalidEvents();
  await testIsChannelEventChannelEvents();
  await testIsChannelEventRejectsServerEvents();
  await testStepWithContinueOnError();

  console.log("pluginRunner utility tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
