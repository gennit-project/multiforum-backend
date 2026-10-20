import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createContentFeaturePolicyRepository } from "../../services/persistence/contentFeaturePolicyRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

test("reads channel and server content feature policies", async () => {
  await driver.executeQuery(`
    CREATE (:Channel {
      uniqueName: "cats",
      eventsEnabled: true,
      feedbackEnabled: false,
      downloadsEnabled: true,
      imageUploadsEnabled: false,
      allowedFileTypes: ["zip", ".stl"]
    })
    CREATE (:ServerConfig {allowedFileTypes: ["zip", "png"]})
  `);
  const repository = createContentFeaturePolicyRepository(driver, "neo4j");

  assert.deepEqual(await repository.findChannelPolicy("cats"), {
    found: true,
    uniqueName: "cats",
    eventsEnabled: true,
    feedbackEnabled: false,
    downloadsEnabled: true,
    imageUploadsEnabled: false,
    wikiEnabled: null,
    allowedFileTypes: ["zip", ".stl"],
  });
  assert.deepEqual(await repository.findServerFileTypePolicy(), {
    found: true,
    allowedFileTypes: ["zip", "png"],
  });
});

test("returns explicit missing policy states", async () => {
  const repository = createContentFeaturePolicyRepository(driver, "neo4j");

  assert.deepEqual(await repository.findChannelPolicy("missing"), {
    found: false,
    uniqueName: null,
    eventsEnabled: null,
    feedbackEnabled: null,
    downloadsEnabled: null,
    imageUploadsEnabled: null,
    wikiEnabled: null,
    allowedFileTypes: [],
  });
  assert.deepEqual(await repository.findServerFileTypePolicy(), {
    found: false,
    allowedFileTypes: [],
  });
});
