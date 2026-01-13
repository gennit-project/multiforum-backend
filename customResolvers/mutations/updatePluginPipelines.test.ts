import assert from "node:assert/strict";
import { validatePipelines, type EventPipelineInput } from "./updatePluginPipelines.js";

// Tests for validatePipelines function

async function testValidPipelineReturnsNull() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [
        { pluginId: 'security-scan', condition: 'ALWAYS' },
        { pluginId: 'auto-labeler', condition: 'PREVIOUS_SUCCEEDED' }
      ],
      stopOnFirstFailure: true
    }
  ];

  const result = validatePipelines(pipelines);
  assert.equal(result, null, "Valid pipeline should return null");
}

async function testEmptyPipelinesArrayIsValid() {
  const pipelines: EventPipelineInput[] = [];
  const result = validatePipelines(pipelines);
  assert.equal(result, null, "Empty pipelines array should be valid");
}

async function testPipelineMissingEventReturnsError() {
  const pipelines = [
    {
      event: '',
      steps: [{ pluginId: 'test-plugin' }]
    }
  ] as EventPipelineInput[];

  const result = validatePipelines(pipelines);
  assert.ok(result !== null, "Pipeline without event should return error");
  assert.ok(result?.includes('event'), "Error should mention 'event'");
}

async function testPipelineMissingStepsReturnsError() {
  const pipelines = [
    {
      event: 'downloadableFile.created',
      steps: []
    }
  ] as EventPipelineInput[];

  const result = validatePipelines(pipelines);
  assert.ok(result !== null, "Pipeline without steps should return error");
  assert.ok(result?.includes('step'), "Error should mention 'step'");
}

async function testStepMissingPluginIdReturnsError() {
  const pipelines = [
    {
      event: 'downloadableFile.created',
      steps: [{ pluginId: '' }]
    }
  ] as EventPipelineInput[];

  const result = validatePipelines(pipelines);
  assert.ok(result !== null, "Step without pluginId should return error");
  assert.ok(result?.includes('pluginId'), "Error should mention 'pluginId'");
}

async function testValidConditionsAreAccepted() {
  const conditions = ['ALWAYS', 'PREVIOUS_SUCCEEDED', 'PREVIOUS_FAILED'] as const;

  for (const condition of conditions) {
    const pipelines: EventPipelineInput[] = [
      {
        event: 'downloadableFile.created',
        steps: [{ pluginId: 'test-plugin', condition }]
      }
    ];

    const result = validatePipelines(pipelines);
    assert.equal(result, null, `Condition '${condition}' should be valid`);
  }
}

async function testStepWithoutConditionIsValid() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [{ pluginId: 'test-plugin' }]  // No condition specified
    }
  ];

  const result = validatePipelines(pipelines);
  assert.equal(result, null, "Step without condition should be valid (defaults to ALWAYS)");
}

async function testMultiplePipelinesAllValid() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [{ pluginId: 'plugin-1' }]
    },
    {
      event: 'downloadableFile.updated',
      steps: [{ pluginId: 'plugin-2' }]
    }
  ];

  const result = validatePipelines(pipelines);
  assert.equal(result, null, "Multiple valid pipelines should return null");
}

async function testMultiplePipelinesOneInvalid() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [{ pluginId: 'plugin-1' }]
    },
    {
      event: '',  // Invalid - missing event
      steps: [{ pluginId: 'plugin-2' }]
    }
  ];

  const result = validatePipelines(pipelines);
  assert.ok(result !== null, "Should return error if any pipeline is invalid");
}

async function testStepWithOptionalFields() {
  const pipelines: EventPipelineInput[] = [
    {
      event: 'downloadableFile.created',
      steps: [
        {
          pluginId: 'test-plugin',
          condition: 'ALWAYS',
          continueOnError: true
        }
      ],
      stopOnFirstFailure: false
    }
  ];

  const result = validatePipelines(pipelines);
  assert.equal(result, null, "Pipeline with all optional fields should be valid");
}

// Run all tests
async function run() {
  await testValidPipelineReturnsNull();
  await testEmptyPipelinesArrayIsValid();
  await testPipelineMissingEventReturnsError();
  await testPipelineMissingStepsReturnsError();
  await testStepMissingPluginIdReturnsError();
  await testValidConditionsAreAccepted();
  await testStepWithoutConditionIsValid();
  await testMultiplePipelinesAllValid();
  await testMultiplePipelinesOneInvalid();
  await testStepWithOptionalFields();

  console.log("updatePluginPipelines validation tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
