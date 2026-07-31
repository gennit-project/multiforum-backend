import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRankingSettingsPatch,
  DEFAULT_RANKING_SETTINGS,
  getCommentHotRankingParams,
  getDiscussionHotRankingParams,
  readRankingSettings,
  serializeRankingSettings,
  validateRankingSettings,
} from "./rankingSettings.js";

test("readRankingSettings uses behavior-preserving defaults when no settings are stored", () => {
  assert.deepEqual(readRankingSettings(null), DEFAULT_RANKING_SETTINGS);
  assert.deepEqual(readRankingSettings(undefined), DEFAULT_RANKING_SETTINGS);
});

test("readRankingSettings accepts stored JSON strings", () => {
  const stored = JSON.stringify({
    version: 1,
    discussionHot: {
      ageOffsetMonths: 3,
      gravity: 2.1,
    },
    commentHot: {
      ageOffsetMonths: 1,
      gravity: 1.4,
    },
  });

  assert.deepEqual(readRankingSettings(stored), JSON.parse(stored));
});

test("readRankingSettings safely falls back when stored settings are malformed", () => {
  assert.deepEqual(readRankingSettings("{not-json"), DEFAULT_RANKING_SETTINGS);
  assert.deepEqual(
    readRankingSettings({
      version: 1,
      discussionHot: { ageOffsetMonths: 0, gravity: 1.8 },
      commentHot: { ageOffsetMonths: 2, gravity: 1.8 },
    }),
    DEFAULT_RANKING_SETTINGS
  );
});

test("validateRankingSettings rejects unsupported versions and unsafe values", () => {
  assert.throws(
    () =>
      validateRankingSettings({
        ...DEFAULT_RANKING_SETTINGS,
        version: 2,
      }),
    /version must be 1/
  );
  assert.throws(
    () =>
      validateRankingSettings({
        ...DEFAULT_RANKING_SETTINGS,
        discussionHot: {
          ...DEFAULT_RANKING_SETTINGS.discussionHot,
          gravity: Number.POSITIVE_INFINITY,
        },
      }),
    /gravity must be a finite number/
  );
  assert.throws(
    () =>
      validateRankingSettings({
        ...DEFAULT_RANKING_SETTINGS,
        commentHot: {
          ...DEFAULT_RANKING_SETTINGS.commentHot,
          ageOffsetMonths: 0,
        },
      }),
    /ageOffsetMonths must be between/
  );
});

test("applyRankingSettingsPatch merges a partial update over current settings", () => {
  const updated = applyRankingSettingsPatch(DEFAULT_RANKING_SETTINGS, {
    discussionHot: {
      gravity: 2.5,
    },
  });

  assert.deepEqual(updated, {
    version: 1,
    discussionHot: {
      ageOffsetMonths: 2,
      gravity: 2.5,
    },
    commentHot: {
      ageOffsetMonths: 2,
      gravity: 1.8,
    },
  });
});

test("serialized settings round-trip and produce scoped query parameters", () => {
  const settings = applyRankingSettingsPatch(DEFAULT_RANKING_SETTINGS, {
    discussionHot: { ageOffsetMonths: 4, gravity: 2 },
    commentHot: { ageOffsetMonths: 0.5, gravity: 1.2 },
  });

  assert.deepEqual(readRankingSettings(serializeRankingSettings(settings)), settings);
  assert.deepEqual(getDiscussionHotRankingParams(settings), {
    hotAgeOffsetMonths: 4,
    hotGravity: 2,
  });
  assert.deepEqual(getCommentHotRankingParams(settings), {
    hotAgeOffsetMonths: 0.5,
    hotGravity: 1.2,
  });
});
