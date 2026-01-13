import assert from "node:assert/strict";
import { validatePipelines, type EventPipelineInput } from "./updatePluginPipelines.js";

// Channel-specific event validation
const VALID_CHANNEL_EVENTS = ['discussionChannel.created'];

const validateChannelEvents = (pipelines: EventPipelineInput[]): string | null => {
  for (const pipeline of pipelines) {
    if (!VALID_CHANNEL_EVENTS.includes(pipeline.event)) {
      return `Invalid event "${pipeline.event}" for channel pipeline. Valid events are: ${VALID_CHANNEL_EVENTS.join(', ')}`;
    }
  }
  return null;
};

// Tests for channel pipeline validation

async function testValidChannelPipelineReturnsNull() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: [
        { pluginId: 'auto-labeler', condition: 'ALWAYS' }
      ],
      stopOnFirstFailure: false
    }
  ];

  // First validate structure
  const structureResult = validatePipelines(pipelines);
  assert.equal(structureResult, null, "Valid pipeline structure should return null");

  // Then validate channel events
  const eventResult = validateChannelEvents(pipelines);
  assert.equal(eventResult, null, "discussionChannel.created should be valid for channel");
}

async function testServerEventRejectedForChannelPipeline() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [{ pluginId: 'security-scan' }]
    }
  ];

  const result = validateChannelEvents(pipelines);
  assert.ok(result !== null, "Server event should be rejected for channel pipeline");
  assert.ok(result?.includes('downloadableFile.created'), "Error should mention the invalid event");
  assert.ok(result?.includes('discussionChannel.created'), "Error should mention valid events");
}

async function testDownloadableFileUpdatedRejectedForChannel() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.updated',
      steps: [{ pluginId: 'test-plugin' }]
    }
  ];

  const result = validateChannelEvents(pipelines);
  assert.ok(result !== null, "downloadableFile.updated should be rejected for channel");
}

async function testUnknownEventRejectedForChannel() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'unknown.event',
      steps: [{ pluginId: 'test-plugin' }]
    }
  ];

  const result = validateChannelEvents(pipelines);
  assert.ok(result !== null, "Unknown event should be rejected for channel");
}

async function testEmptyChannelPipelinesIsValid() {
  const pipelines: EventPipelineInput[] = [];

  const structureResult = validatePipelines(pipelines);
  assert.equal(structureResult, null, "Empty pipelines should pass structure validation");

  const eventResult = validateChannelEvents(pipelines);
  assert.equal(eventResult, null, "Empty pipelines should pass event validation");
}

async function testMultipleChannelPipelinesWithSameEvent() {
  // While unusual, multiple pipelines for the same event should be valid
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: [{ pluginId: 'plugin-1' }]
    },
    {
      event: 'discussionChannel.created',
      steps: [{ pluginId: 'plugin-2' }]
    }
  ];

  const structureResult = validatePipelines(pipelines);
  assert.equal(structureResult, null, "Multiple pipelines should pass structure validation");

  const eventResult = validateChannelEvents(pipelines);
  assert.equal(eventResult, null, "Multiple channel pipelines should be valid");
}

async function testChannelPipelineWithMultipleSteps() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: [
        { pluginId: 'auto-labeler', condition: 'ALWAYS' },
        { pluginId: 'content-classifier', condition: 'PREVIOUS_SUCCEEDED' },
        { pluginId: 'notification-sender', condition: 'ALWAYS', continueOnError: true }
      ],
      stopOnFirstFailure: true
    }
  ];

  const structureResult = validatePipelines(pipelines);
  assert.equal(structureResult, null, "Pipeline with multiple steps should be valid");

  const eventResult = validateChannelEvents(pipelines);
  assert.equal(eventResult, null, "Channel event should be valid");
}

async function testChannelPipelineStillValidatesStructure() {
  // Even with valid channel event, structure must be valid
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: []  // Invalid - no steps
    }
  ];

  const structureResult = validatePipelines(pipelines);
  assert.ok(structureResult !== null, "Pipeline without steps should fail structure validation");
}

async function testChannelPipelineMissingPluginId() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: [{ pluginId: '' }]
    }
  ];

  const structureResult = validatePipelines(pipelines);
  assert.ok(structureResult !== null, "Step without pluginId should fail");
  assert.ok(structureResult?.includes('pluginId'), "Error should mention pluginId");
}

async function testMixedServerAndChannelEventsRejected() {
  // If someone tries to mix server and channel events, should fail
  const pipelines: EventPipelineInput[] = [
    {
      event: 'discussionChannel.created',
      steps: [{ pluginId: 'auto-labeler' }]
    },
    {
      event: 'downloadableFile.created',  // Server event mixed in
      steps: [{ pluginId: 'security-scan' }]
    }
  ];

  // Structure is valid
  const structureResult = validatePipelines(pipelines);
  assert.equal(structureResult, null, "Structure should be valid");

  // But channel event validation should fail
  const eventResult = validateChannelEvents(pipelines);
  assert.ok(eventResult !== null, "Mixed events should be rejected for channel");
}

// Run all tests
async function run() {
  await testValidChannelPipelineReturnsNull();
  await testServerEventRejectedForChannelPipeline();
  await testDownloadableFileUpdatedRejectedForChannel();
  await testUnknownEventRejectedForChannel();
  await testEmptyChannelPipelinesIsValid();
  await testMultipleChannelPipelinesWithSameEvent();
  await testChannelPipelineWithMultipleSteps();
  await testChannelPipelineStillValidatesStructure();
  await testChannelPipelineMissingPluginId();
  await testMixedServerAndChannelEventsRejected();

  console.log("updateChannelPluginPipelines validation tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
