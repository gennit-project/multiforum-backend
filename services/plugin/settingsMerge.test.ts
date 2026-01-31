import assert from "node:assert/strict";
import { mergeSettings } from "./pipelineUtils.js";

// Helper function that mirrors the logic in commentTrigger.ts and channelTrigger.ts
const parseIfString = (value: any): any => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value || {};
};

// Helper to wrap channel settings in 'channel' sub-key (mirrors trigger logic)
const wrapChannelSettings = (channelSettingsRaw: any): any => {
  const parsed = parseIfString(channelSettingsRaw);
  return Object.keys(parsed).length > 0 ? { channel: parsed } : {};
};

// Tests for mergeSettings with nested structures

async function testMergeSettingsBasicObjects() {
  const defaults = { a: 1, b: 2 };
  const overrides = { b: 3, c: 4 };
  const result = mergeSettings(defaults, overrides);

  assert.deepEqual(result, { a: 1, b: 3, c: 4 }, "Should merge objects with override precedence");
}

async function testMergeSettingsNestedObjects() {
  const defaults = {
    server: { botName: "default-bot", model: "gpt-4" },
    channel: { overrideProfiles: false }
  };
  const overrides = {
    channel: { overrideProfiles: true, botName: "custom-bot" }
  };
  const result = mergeSettings(defaults, overrides);

  assert.deepEqual(result, {
    server: { botName: "default-bot", model: "gpt-4" },
    channel: { overrideProfiles: true, botName: "custom-bot" }
  }, "Should deep merge nested objects");
}

async function testMergeSettingsPreservesServerWhenChannelOverrides() {
  const defaults = {
    server: { botName: "chatgpt-bot", model: "gpt-4o-mini", temperature: 0.7 },
    channel: { overrideProfiles: false, botName: "chatgpt-bot" }
  };
  const channelOverrides = {
    channel: { overrideProfiles: true, botName: "test-bot", defaultProfileId: "test" }
  };
  const result = mergeSettings(defaults, channelOverrides);

  assert.equal(result.server.botName, "chatgpt-bot", "Server settings should be preserved");
  assert.equal(result.server.model, "gpt-4o-mini", "Server model should be preserved");
  assert.equal(result.channel.botName, "test-bot", "Channel botName should be overridden");
  assert.equal(result.channel.overrideProfiles, true, "Channel overrideProfiles should be true");
  assert.equal(result.channel.defaultProfileId, "test", "Channel defaultProfileId should be added");
}

async function testMergeSettingsNullOverride() {
  const defaults = { a: 1, b: 2 };
  const result = mergeSettings(defaults, null);

  assert.deepEqual(result, { a: 1, b: 2 }, "Null override should return defaults");
}

async function testMergeSettingsUndefinedOverride() {
  const defaults = { a: 1, b: 2 };
  const result = mergeSettings(defaults, undefined);

  assert.deepEqual(result, { a: 1, b: 2 }, "Undefined override should return defaults");
}

async function testMergeSettingsEmptyOverride() {
  const defaults = { server: { botName: "default" }, channel: {} };
  const result = mergeSettings(defaults, {});

  assert.deepEqual(result, defaults, "Empty override should return defaults unchanged");
}

// Tests for parseIfString helper

async function testParseIfStringWithValidJson() {
  const jsonString = '{"botName": "test-bot", "overrideProfiles": true}';
  const result = parseIfString(jsonString);

  assert.deepEqual(result, { botName: "test-bot", overrideProfiles: true }, "Should parse valid JSON string");
}

async function testParseIfStringWithInvalidJson() {
  const invalidJson = "not valid json {";
  const result = parseIfString(invalidJson);

  assert.deepEqual(result, {}, "Invalid JSON should return empty object");
}

async function testParseIfStringWithObject() {
  const obj = { botName: "test-bot" };
  const result = parseIfString(obj);

  assert.deepEqual(result, obj, "Object should pass through unchanged");
}

async function testParseIfStringWithNull() {
  const result = parseIfString(null);

  assert.deepEqual(result, {}, "Null should return empty object");
}

async function testParseIfStringWithUndefined() {
  const result = parseIfString(undefined);

  assert.deepEqual(result, {}, "Undefined should return empty object");
}

async function testParseIfStringWithNestedJson() {
  const jsonString = '{"server":{"botName":"chatgpt-bot","model":"gpt-4o-mini"},"channel":{"overrideProfiles":false}}';
  const result = parseIfString(jsonString);

  assert.equal(result.server.botName, "chatgpt-bot", "Should parse nested server settings");
  assert.equal(result.channel.overrideProfiles, false, "Should parse nested channel settings");
}

// Tests for wrapChannelSettings helper

async function testWrapChannelSettingsWithFlatObject() {
  const flatSettings = { overrideProfiles: true, botName: "test-bot" };
  const result = wrapChannelSettings(flatSettings);

  assert.deepEqual(result, {
    channel: { overrideProfiles: true, botName: "test-bot" }
  }, "Should wrap flat settings in 'channel' key");
}

async function testWrapChannelSettingsWithJsonString() {
  const jsonString = '{"overrideProfiles":true,"botName":"test-bot"}';
  const result = wrapChannelSettings(jsonString);

  assert.deepEqual(result, {
    channel: { overrideProfiles: true, botName: "test-bot" }
  }, "Should parse and wrap JSON string settings");
}

async function testWrapChannelSettingsWithEmptyObject() {
  const result = wrapChannelSettings({});

  assert.deepEqual(result, {}, "Empty object should return empty object (no wrapping)");
}

async function testWrapChannelSettingsWithNull() {
  const result = wrapChannelSettings(null);

  assert.deepEqual(result, {}, "Null should return empty object");
}

// Integration tests: Full settings merge flow

async function testFullSettingsMergeFlow() {
  // Simulate the actual data as it comes from the database
  const settingsDefaultsRaw = '{"server":{"botName":"chatgpt-bot","model":"gpt-4o-mini","temperature":0.7,"maxTokens":800,"defaultProfileId":"general","profiles":[{"id":"general","displayName":"General Assistant","prompt":"You are helpful."}]},"channel":{"overrideProfiles":false,"botName":"chatgpt-bot","defaultProfileId":"","profiles":[]}}';
  const serverSettingsRaw = {}; // Often empty if using defaults
  const channelSettingsRaw = '{"overrideProfiles":true,"botName":"test-bot","defaultProfileId":"test-bot","profiles":[]}';

  // Parse all settings
  const settingsDefaults = parseIfString(settingsDefaultsRaw);
  const serverSettings = parseIfString(serverSettingsRaw);
  const channelSettingsWrapped = wrapChannelSettings(channelSettingsRaw);

  // Merge: defaults < server < channel
  const result = mergeSettings(
    mergeSettings(settingsDefaults, serverSettings),
    channelSettingsWrapped
  );

  // Server settings should be preserved
  assert.equal(result.server.botName, "chatgpt-bot", "Server botName should be preserved");
  assert.equal(result.server.model, "gpt-4o-mini", "Server model should be preserved");
  assert.equal(result.server.temperature, 0.7, "Server temperature should be preserved");
  assert.equal(result.server.profiles.length, 1, "Server profiles should be preserved");

  // Channel settings should be overridden
  assert.equal(result.channel.overrideProfiles, true, "Channel overrideProfiles should be true");
  assert.equal(result.channel.botName, "test-bot", "Channel botName should be test-bot");
  assert.equal(result.channel.defaultProfileId, "test-bot", "Channel defaultProfileId should be test-bot");
}

async function testFullSettingsMergeFlowWithServerOverrides() {
  const settingsDefaultsRaw = '{"server":{"botName":"default-bot","model":"gpt-3.5-turbo"},"channel":{}}';
  const serverSettingsRaw = '{"server":{"model":"gpt-4o","maxTokens":1000}}';
  const channelSettingsRaw = '{"botName":"channel-bot"}';

  const settingsDefaults = parseIfString(settingsDefaultsRaw);
  const serverSettings = parseIfString(serverSettingsRaw);
  const channelSettingsWrapped = wrapChannelSettings(channelSettingsRaw);

  const result = mergeSettings(
    mergeSettings(settingsDefaults, serverSettings),
    channelSettingsWrapped
  );

  // Server settings should be merged (server overrides defaults)
  assert.equal(result.server.botName, "default-bot", "Server botName from defaults");
  assert.equal(result.server.model, "gpt-4o", "Server model should be overridden by server settings");
  assert.equal(result.server.maxTokens, 1000, "Server maxTokens should be added from server settings");

  // Channel settings should override channel defaults
  assert.equal(result.channel.botName, "channel-bot", "Channel botName should be from channel settings");
}

async function testSettingsMergeWithNoChannelOverrides() {
  const settingsDefaultsRaw = '{"server":{"botName":"chatgpt-bot"},"channel":{"overrideProfiles":false}}';
  const serverSettingsRaw = {};
  const channelSettingsRaw = null;

  const settingsDefaults = parseIfString(settingsDefaultsRaw);
  const serverSettings = parseIfString(serverSettingsRaw);
  const channelSettingsWrapped = wrapChannelSettings(channelSettingsRaw);

  const result = mergeSettings(
    mergeSettings(settingsDefaults, serverSettings),
    channelSettingsWrapped
  );

  // Should just use defaults when no overrides
  assert.equal(result.server.botName, "chatgpt-bot", "Server botName should be from defaults");
  assert.equal(result.channel.overrideProfiles, false, "Channel overrideProfiles should be false from defaults");
}

// Run all tests
async function run() {
  // Basic merge tests
  await testMergeSettingsBasicObjects();
  await testMergeSettingsNestedObjects();
  await testMergeSettingsPreservesServerWhenChannelOverrides();
  await testMergeSettingsNullOverride();
  await testMergeSettingsUndefinedOverride();
  await testMergeSettingsEmptyOverride();

  // parseIfString tests
  await testParseIfStringWithValidJson();
  await testParseIfStringWithInvalidJson();
  await testParseIfStringWithObject();
  await testParseIfStringWithNull();
  await testParseIfStringWithUndefined();
  await testParseIfStringWithNestedJson();

  // wrapChannelSettings tests
  await testWrapChannelSettingsWithFlatObject();
  await testWrapChannelSettingsWithJsonString();
  await testWrapChannelSettingsWithEmptyObject();
  await testWrapChannelSettingsWithNull();

  // Integration tests
  await testFullSettingsMergeFlow();
  await testFullSettingsMergeFlowWithServerOverrides();
  await testSettingsMergeWithNoChannelOverrides();

  console.log("settingsMerge tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
