import assert from "node:assert/strict";
import {
  generatePipelineId,
  shouldRunStep,
  getAttachmentUrls,
  parseStoredPipelines,
  parseManifest,
  compareVersions,
  buildPluginVersionMaps,
  getPluginForStep,
} from "./pipelineUtils.js";

// Inline type definition to avoid importing from types.js which has external dependencies
type PipelineStep = {
  pluginId: string;
  version?: string;
  continueOnError?: boolean;
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED';
};

// ============================================
// generatePipelineId tests
// ============================================

async function testGeneratePipelineIdFormat() {
  const id = generatePipelineId();
  const parts = id.split("-");

  assert.equal(parts[0], "pipeline", "ID should start with 'pipeline'");
  assert.equal(parts.length, 3, "ID should have 3 parts separated by hyphens");
  assert.ok(!isNaN(Number(parts[1])), "Second part should be a timestamp number");
  assert.equal(parts[2].length, 8, "Third part should be 8 hex characters (4 bytes)");
}

async function testGeneratePipelineIdUniqueness() {
  const id1 = generatePipelineId();
  const id2 = generatePipelineId();

  assert.notEqual(id1, id2, "Generated IDs should be unique");
}

async function testGeneratePipelineIdTimestampIsRecent() {
  const before = Date.now();
  const id = generatePipelineId();
  const after = Date.now();

  const timestamp = parseInt(id.split("-")[1], 10);

  assert.ok(timestamp >= before, "Timestamp should be >= time before generation");
  assert.ok(timestamp <= after, "Timestamp should be <= time after generation");
}

// ============================================
// shouldRunStep tests
// ============================================

async function testShouldRunStepAlwaysCondition() {
  const step: PipelineStep = { pluginId: "test-plugin", condition: "ALWAYS" };

  assert.equal(shouldRunStep(step, null), true, "ALWAYS should run with null previous status");
  assert.equal(shouldRunStep(step, "SUCCEEDED"), true, "ALWAYS should run after success");
  assert.equal(shouldRunStep(step, "FAILED"), true, "ALWAYS should run after failure");
}

async function testShouldRunStepDefaultCondition() {
  const step: PipelineStep = { pluginId: "test-plugin" }; // No condition specified

  assert.equal(shouldRunStep(step, null), true, "Default condition should run with null");
  assert.equal(shouldRunStep(step, "SUCCEEDED"), true, "Default condition should run after success");
  assert.equal(shouldRunStep(step, "FAILED"), true, "Default condition should run after failure");
}

async function testShouldRunStepPreviousSucceededCondition() {
  const step: PipelineStep = { pluginId: "test-plugin", condition: "PREVIOUS_SUCCEEDED" };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_SUCCEEDED should not run with null");
  assert.equal(shouldRunStep(step, "SUCCEEDED"), true, "PREVIOUS_SUCCEEDED should run after success");
  assert.equal(shouldRunStep(step, "FAILED"), false, "PREVIOUS_SUCCEEDED should not run after failure");
}

async function testShouldRunStepPreviousFailedCondition() {
  const step: PipelineStep = { pluginId: "test-plugin", condition: "PREVIOUS_FAILED" };

  assert.equal(shouldRunStep(step, null), false, "PREVIOUS_FAILED should not run with null");
  assert.equal(shouldRunStep(step, "SUCCEEDED"), false, "PREVIOUS_FAILED should not run after success");
  assert.equal(shouldRunStep(step, "FAILED"), true, "PREVIOUS_FAILED should run after failure");
}

async function testShouldRunStepUnknownCondition() {
  // Test that unknown conditions default to true (as per implementation)
  const step = { pluginId: "test-plugin", condition: "UNKNOWN" as any };

  assert.equal(shouldRunStep(step, null), true, "Unknown condition should default to true");
}

// ============================================
// getAttachmentUrls tests
// ============================================

async function testGetAttachmentUrlsWithUrl() {
  const downloadableFile = { url: "https://example.com/file.zip" };
  const urls = getAttachmentUrls(downloadableFile);

  assert.deepEqual(urls, ["https://example.com/file.zip"], "Should return URL in array");
}

async function testGetAttachmentUrlsWithoutUrl() {
  const downloadableFile = { name: "file.zip", size: 1024 };
  const urls = getAttachmentUrls(downloadableFile);

  assert.deepEqual(urls, [], "Should return empty array when no URL");
}

async function testGetAttachmentUrlsWithEmptyUrl() {
  const downloadableFile = { url: "" };
  const urls = getAttachmentUrls(downloadableFile);

  assert.deepEqual(urls, [], "Should return empty array when URL is empty string");
}

async function testGetAttachmentUrlsWithNullUrl() {
  const downloadableFile = { url: null };
  const urls = getAttachmentUrls(downloadableFile);

  assert.deepEqual(urls, [], "Should return empty array when URL is null");
}

async function testGetAttachmentUrlsWithEmptyObject() {
  const urls = getAttachmentUrls({});

  assert.deepEqual(urls, [], "Should return empty array for empty object");
}

// ============================================
// parseStoredPipelines tests
// ============================================

async function testParseStoredPipelinesWithValidJsonString() {
  const stored = JSON.stringify([
    { event: "file.created", steps: [{ plugin: "scanner" }] }
  ]);
  const result = parseStoredPipelines(stored);

  assert.equal(result.length, 1, "Should parse JSON string to array");
  assert.equal(result[0].event, "file.created", "Should preserve event property");
}

async function testParseStoredPipelinesWithInvalidJsonString() {
  const stored = "not valid json {";
  const result = parseStoredPipelines(stored);

  assert.deepEqual(result, [], "Invalid JSON should return empty array");
}

async function testParseStoredPipelinesWithArray() {
  const stored = [{ event: "comment.created", steps: [] }];
  const result = parseStoredPipelines(stored);

  assert.equal(result, stored, "Array should pass through unchanged");
}

async function testParseStoredPipelinesWithObject() {
  const stored = { event: "file.created", steps: [] };
  const result = parseStoredPipelines(stored);

  assert.deepEqual(result, [], "Non-array object should return empty array");
}

async function testParseStoredPipelinesWithNull() {
  const result = parseStoredPipelines(null);

  assert.deepEqual(result, [], "Null should return empty array");
}

async function testParseStoredPipelinesWithUndefined() {
  const result = parseStoredPipelines(undefined);

  assert.deepEqual(result, [], "Undefined should return empty array");
}

async function testParseStoredPipelinesWithEmptyString() {
  const result = parseStoredPipelines("");

  assert.deepEqual(result, [], "Empty string should return empty array");
}

async function testParseStoredPipelinesWithEmptyArray() {
  const stored = "[]";
  const result = parseStoredPipelines(stored);

  assert.deepEqual(result, [], "Empty array JSON should return empty array");
}

// ============================================
// parseManifest tests
// ============================================

async function testParseManifestWithValidJsonString() {
  const manifest = JSON.stringify({ name: "test-plugin", version: "1.0.0" });
  const result = parseManifest(manifest);

  assert.equal(result.name, "test-plugin", "Should parse name");
  assert.equal(result.version, "1.0.0", "Should parse version");
}

async function testParseManifestWithInvalidJsonString() {
  const manifest = "invalid json {";
  const result = parseManifest(manifest);

  assert.deepEqual(result, {}, "Invalid JSON should return empty object");
}

async function testParseManifestWithObject() {
  const manifest = { name: "plugin", settings: { key: "value" } };
  const result = parseManifest(manifest);

  assert.equal(result, manifest, "Object should pass through unchanged");
}

async function testParseManifestWithNull() {
  const result = parseManifest(null);

  assert.deepEqual(result, {}, "Null should return empty object");
}

async function testParseManifestWithUndefined() {
  const result = parseManifest(undefined);

  assert.deepEqual(result, {}, "Undefined should return empty object");
}

async function testParseManifestWithEmptyString() {
  const result = parseManifest("");

  assert.deepEqual(result, {}, "Empty string should return empty object");
}

// ============================================
// compareVersions tests
// ============================================

async function testCompareVersionsEqual() {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0, "Equal versions should return 0");
  assert.equal(compareVersions("2.5.3", "2.5.3"), 0, "Equal versions should return 0");
}

async function testCompareVersionsGreater() {
  assert.ok(compareVersions("2.0.0", "1.0.0") > 0, "2.0.0 > 1.0.0");
  assert.ok(compareVersions("1.1.0", "1.0.0") > 0, "1.1.0 > 1.0.0");
  assert.ok(compareVersions("1.0.1", "1.0.0") > 0, "1.0.1 > 1.0.0");
}

async function testCompareVersionsLesser() {
  assert.ok(compareVersions("1.0.0", "2.0.0") < 0, "1.0.0 < 2.0.0");
  assert.ok(compareVersions("1.0.0", "1.1.0") < 0, "1.0.0 < 1.1.0");
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0, "1.0.0 < 1.0.1");
}

async function testCompareVersionsDifferentLengths() {
  assert.equal(compareVersions("1.0", "1.0.0"), 0, "1.0 should equal 1.0.0");
  assert.equal(compareVersions("1", "1.0.0"), 0, "1 should equal 1.0.0");
  assert.ok(compareVersions("1.0.1", "1.0") > 0, "1.0.1 > 1.0");
  assert.ok(compareVersions("1.0", "1.0.1") < 0, "1.0 < 1.0.1");
}

async function testCompareVersionsWithManyParts() {
  assert.ok(compareVersions("1.2.3.4", "1.2.3.3") > 0, "1.2.3.4 > 1.2.3.3");
  assert.equal(compareVersions("1.2.3.4", "1.2.3.4"), 0, "Equal 4-part versions");
}

async function testCompareVersionsWithNonNumericParts() {
  // Non-numeric parts should be treated as 0
  assert.equal(compareVersions("1.0.beta", "1.0.0"), 0, "Non-numeric part should be treated as 0");
}

async function testCompareVersionsLargeNumbers() {
  assert.ok(compareVersions("10.0.0", "9.0.0") > 0, "10.0.0 > 9.0.0");
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0, "1.10.0 > 1.9.0");
  assert.ok(compareVersions("1.0.100", "1.0.99") > 0, "1.0.100 > 1.0.99");
}

// ============================================
// buildPluginVersionMaps tests
// ============================================

async function testBuildPluginVersionMapsEmpty() {
  const result = buildPluginVersionMaps([]);

  assert.equal(result.size, 0, "Empty edges should return empty map");
}

async function testBuildPluginVersionMapsSinglePlugin() {
  const edges = [
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "1.0.0" }
    }
  ];
  const result = buildPluginVersionMaps(edges);

  assert.equal(result.size, 1, "Should have one plugin");
  assert.equal(result.get("scanner")?.length, 1, "Should have one version");
  assert.equal(result.get("scanner")?.[0].version, "1.0.0", "Version should match");
}

async function testBuildPluginVersionMapsMultipleVersionsSorted() {
  const edges = [
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "1.0.0" }
    },
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "2.0.0" }
    },
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "1.5.0" }
    }
  ];
  const result = buildPluginVersionMaps(edges);

  const versions = result.get("scanner");
  assert.equal(versions?.length, 3, "Should have 3 versions");
  assert.equal(versions?.[0].version, "2.0.0", "First should be latest (2.0.0)");
  assert.equal(versions?.[1].version, "1.5.0", "Second should be 1.5.0");
  assert.equal(versions?.[2].version, "1.0.0", "Third should be oldest (1.0.0)");
}

async function testBuildPluginVersionMapsSkipsDisabled() {
  const edges = [
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "1.0.0" }
    },
    {
      properties: { enabled: false },
      node: { Plugin: { name: "scanner" }, version: "2.0.0" }
    }
  ];
  const result = buildPluginVersionMaps(edges);

  assert.equal(result.get("scanner")?.length, 1, "Should only include enabled versions");
  assert.equal(result.get("scanner")?.[0].version, "1.0.0", "Only enabled version should be present");
}

async function testBuildPluginVersionMapsMultiplePlugins() {
  const edges = [
    {
      properties: { enabled: true },
      node: { Plugin: { name: "scanner" }, version: "1.0.0" }
    },
    {
      properties: { enabled: true },
      node: { Plugin: { name: "notifier" }, version: "2.0.0" }
    }
  ];
  const result = buildPluginVersionMaps(edges);

  assert.equal(result.size, 2, "Should have two plugins");
  assert.ok(result.has("scanner"), "Should have scanner");
  assert.ok(result.has("notifier"), "Should have notifier");
}

async function testBuildPluginVersionMapsSkipsMissingPluginName() {
  const edges = [
    {
      properties: { enabled: true },
      node: { version: "1.0.0" } // Missing Plugin.name
    },
    {
      properties: { enabled: true },
      node: { Plugin: { name: "valid" }, version: "1.0.0" }
    }
  ];
  const result = buildPluginVersionMaps(edges);

  assert.equal(result.size, 1, "Should only include edges with plugin name");
  assert.ok(result.has("valid"), "Should have valid plugin");
}

// ============================================
// getPluginForStep tests
// ============================================

async function testGetPluginForStepLatestVersion() {
  const map = new Map([
    ["scanner", [
      { version: "2.0.0", edgeData: { id: "v2" } },
      { version: "1.0.0", edgeData: { id: "v1" } }
    ]]
  ]);

  const result = getPluginForStep(map, "scanner");

  assert.equal(result?.version, "2.0.0", "Should return latest version");
  assert.equal(result?.edgeData.id, "v2", "Should return correct edge data");
}

async function testGetPluginForStepSpecificVersion() {
  const map = new Map([
    ["scanner", [
      { version: "2.0.0", edgeData: { id: "v2" } },
      { version: "1.0.0", edgeData: { id: "v1" } }
    ]]
  ]);

  const result = getPluginForStep(map, "scanner", "1.0.0");

  assert.equal(result?.version, "1.0.0", "Should return requested version");
  assert.equal(result?.edgeData.id, "v1", "Should return correct edge data");
}

async function testGetPluginForStepVersionNotFound() {
  const map = new Map([
    ["scanner", [
      { version: "2.0.0", edgeData: { id: "v2" } }
    ]]
  ]);

  const result = getPluginForStep(map, "scanner", "1.0.0");

  assert.equal(result, null, "Should return null when requested version not found");
}

async function testGetPluginForStepPluginNotFound() {
  const map = new Map([
    ["scanner", [{ version: "1.0.0", edgeData: {} }]]
  ]);

  const result = getPluginForStep(map, "notifier");

  assert.equal(result, null, "Should return null when plugin not found");
}

async function testGetPluginForStepEmptyVersions() {
  const map = new Map([
    ["scanner", []]
  ]);

  const result = getPluginForStep(map, "scanner");

  assert.equal(result, null, "Should return null when no versions available");
}

async function testGetPluginForStepEmptyMap() {
  const map = new Map<string, Array<{ version: string; edgeData: any }>>();

  const result = getPluginForStep(map, "scanner");

  assert.equal(result, null, "Should return null for empty map");
}

// Run all tests
async function run() {
  // generatePipelineId tests
  await testGeneratePipelineIdFormat();
  await testGeneratePipelineIdUniqueness();
  await testGeneratePipelineIdTimestampIsRecent();

  // shouldRunStep tests
  await testShouldRunStepAlwaysCondition();
  await testShouldRunStepDefaultCondition();
  await testShouldRunStepPreviousSucceededCondition();
  await testShouldRunStepPreviousFailedCondition();
  await testShouldRunStepUnknownCondition();

  // getAttachmentUrls tests
  await testGetAttachmentUrlsWithUrl();
  await testGetAttachmentUrlsWithoutUrl();
  await testGetAttachmentUrlsWithEmptyUrl();
  await testGetAttachmentUrlsWithNullUrl();
  await testGetAttachmentUrlsWithEmptyObject();

  // parseStoredPipelines tests
  await testParseStoredPipelinesWithValidJsonString();
  await testParseStoredPipelinesWithInvalidJsonString();
  await testParseStoredPipelinesWithArray();
  await testParseStoredPipelinesWithObject();
  await testParseStoredPipelinesWithNull();
  await testParseStoredPipelinesWithUndefined();
  await testParseStoredPipelinesWithEmptyString();
  await testParseStoredPipelinesWithEmptyArray();

  // parseManifest tests
  await testParseManifestWithValidJsonString();
  await testParseManifestWithInvalidJsonString();
  await testParseManifestWithObject();
  await testParseManifestWithNull();
  await testParseManifestWithUndefined();
  await testParseManifestWithEmptyString();

  // compareVersions tests
  await testCompareVersionsEqual();
  await testCompareVersionsGreater();
  await testCompareVersionsLesser();
  await testCompareVersionsDifferentLengths();
  await testCompareVersionsWithManyParts();
  await testCompareVersionsWithNonNumericParts();
  await testCompareVersionsLargeNumbers();

  // buildPluginVersionMaps tests
  await testBuildPluginVersionMapsEmpty();
  await testBuildPluginVersionMapsSinglePlugin();
  await testBuildPluginVersionMapsMultipleVersionsSorted();
  await testBuildPluginVersionMapsSkipsDisabled();
  await testBuildPluginVersionMapsMultiplePlugins();
  await testBuildPluginVersionMapsSkipsMissingPluginName();

  // getPluginForStep tests
  await testGetPluginForStepLatestVersion();
  await testGetPluginForStepSpecificVersion();
  await testGetPluginForStepVersionNotFound();
  await testGetPluginForStepPluginNotFound();
  await testGetPluginForStepEmptyVersions();
  await testGetPluginForStepEmptyMap();

  console.log("pipelineUtils tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
