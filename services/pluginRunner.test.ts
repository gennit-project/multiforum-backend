import assert from "node:assert/strict";
import { shouldRunStep, generatePipelineId, type PipelineStep } from "./pluginRunner.js";

// Tests for shouldRunStep function
async function testShouldRunStepAlwaysCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'ALWAYS' };

  // ALWAYS should run regardless of previous status
  assert.equal(shouldRunStep(step, null), true, "ALWAYS should run when no previous status");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "ALWAYS should run when previous succeeded");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "ALWAYS should run when previous failed");
}

async function testShouldRunStepDefaultCondition() {
  // When no condition is specified, default should be ALWAYS
  const step: PipelineStep = { pluginId: 'test-plugin' };

  assert.equal(shouldRunStep(step, null), true, "Default condition should run when no previous status");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "Default condition should run when previous succeeded");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "Default condition should run when previous failed");
}

async function testShouldRunStepPreviousSucceededCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'PREVIOUS_SUCCEEDED' };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_SUCCEEDED should not run when no previous status");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), true, "PREVIOUS_SUCCEEDED should run when previous succeeded");
  assert.equal(shouldRunStep(step, 'FAILED'), false, "PREVIOUS_SUCCEEDED should not run when previous failed");
}

async function testShouldRunStepPreviousFailedCondition() {
  const step: PipelineStep = { pluginId: 'test-plugin', condition: 'PREVIOUS_FAILED' };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_FAILED should not run when no previous status");
  assert.equal(shouldRunStep(step, 'SUCCEEDED'), false, "PREVIOUS_FAILED should not run when previous succeeded");
  assert.equal(shouldRunStep(step, 'FAILED'), true, "PREVIOUS_FAILED should run when previous failed");
}

// Tests for generatePipelineId function
async function testGeneratePipelineIdFormat() {
  const pipelineId = generatePipelineId();

  // Should start with 'pipeline-'
  assert.ok(pipelineId.startsWith('pipeline-'), "Pipeline ID should start with 'pipeline-'");

  // Should have correct format: pipeline-{timestamp}-{hex}
  const parts = pipelineId.split('-');
  assert.equal(parts.length, 3, "Pipeline ID should have 3 parts separated by hyphens");
  assert.equal(parts[0], 'pipeline', "First part should be 'pipeline'");

  // Second part should be a valid timestamp (number)
  const timestamp = parseInt(parts[1], 10);
  assert.ok(!isNaN(timestamp), "Second part should be a valid number (timestamp)");
  assert.ok(timestamp > 0, "Timestamp should be positive");

  // Third part should be 8 hex characters (4 bytes = 8 hex chars)
  assert.equal(parts[2].length, 8, "Third part should be 8 hex characters");
  assert.ok(/^[0-9a-f]+$/.test(parts[2]), "Third part should be valid hex");
}

async function testGeneratePipelineIdUniqueness() {
  const id1 = generatePipelineId();
  const id2 = generatePipelineId();

  assert.notEqual(id1, id2, "Generated pipeline IDs should be unique");
}

// Run all tests
async function run() {
  // shouldRunStep tests
  await testShouldRunStepAlwaysCondition();
  await testShouldRunStepDefaultCondition();
  await testShouldRunStepPreviousSucceededCondition();
  await testShouldRunStepPreviousFailedCondition();

  // generatePipelineId tests
  await testGeneratePipelineIdFormat();
  await testGeneratePipelineIdUniqueness();

  console.log("pluginRunner tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
