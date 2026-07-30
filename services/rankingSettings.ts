export const RANKING_SETTINGS_VERSION = 1;

export type HotRankingSettings = {
  ageOffsetMonths: number;
  gravity: number;
};

export type RankingSettings = {
  version: typeof RANKING_SETTINGS_VERSION;
  discussionHot: HotRankingSettings;
  commentHot: HotRankingSettings;
};

export type HotRankingSettingsPatch = Partial<HotRankingSettings>;

export type RankingSettingsPatch = {
  discussionHot?: HotRankingSettingsPatch;
  commentHot?: HotRankingSettingsPatch;
};

export const DEFAULT_RANKING_SETTINGS: RankingSettings = {
  version: RANKING_SETTINGS_VERSION,
  discussionHot: {
    ageOffsetMonths: 2,
    gravity: 1.8,
  },
  commentHot: {
    ageOffsetMonths: 2,
    gravity: 1.8,
  },
};

const MIN_AGE_OFFSET_MONTHS = 0.01;
const MAX_AGE_OFFSET_MONTHS = 120;
const MIN_GRAVITY = 0.1;
const MAX_GRAVITY = 10;

const cloneDefaults = (): RankingSettings => ({
  version: RANKING_SETTINGS_VERSION,
  discussionHot: { ...DEFAULT_RANKING_SETTINGS.discussionHot },
  commentHot: { ...DEFAULT_RANKING_SETTINGS.commentHot },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isRecord(value) ? value : null;
};

const validateFiniteNumber = ({
  value,
  path,
  min,
  max,
}: {
  value: unknown;
  path: string;
  min: number;
  max: number;
}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  if (value < min || value > max) {
    throw new Error(`${path} must be between ${min} and ${max}.`);
  }
  return value;
};

const validateHotRankingSettings = (
  value: unknown,
  path: string
): HotRankingSettings => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return {
    ageOffsetMonths: validateFiniteNumber({
      value: value.ageOffsetMonths,
      path: `${path}.ageOffsetMonths`,
      min: MIN_AGE_OFFSET_MONTHS,
      max: MAX_AGE_OFFSET_MONTHS,
    }),
    gravity: validateFiniteNumber({
      value: value.gravity,
      path: `${path}.gravity`,
      min: MIN_GRAVITY,
      max: MAX_GRAVITY,
    }),
  };
};

export const validateRankingSettings = (value: unknown): RankingSettings => {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    throw new Error("Ranking settings must be a JSON object.");
  }
  if (parsed.version !== RANKING_SETTINGS_VERSION) {
    throw new Error(
      `Ranking settings version must be ${RANKING_SETTINGS_VERSION}.`
    );
  }

  return {
    version: RANKING_SETTINGS_VERSION,
    discussionHot: validateHotRankingSettings(
      parsed.discussionHot,
      "discussionHot"
    ),
    commentHot: validateHotRankingSettings(parsed.commentHot, "commentHot"),
  };
};

export const readRankingSettings = (value: unknown): RankingSettings => {
  if (value === null || value === undefined || value === "") {
    return cloneDefaults();
  }

  try {
    return validateRankingSettings(value);
  } catch {
    return cloneDefaults();
  }
};

const mergeHotRankingPatch = (
  current: HotRankingSettings,
  patch: HotRankingSettingsPatch | undefined
): HotRankingSettings => ({
  ...current,
  ...(patch ?? {}),
});

export const applyRankingSettingsPatch = (
  currentValue: unknown,
  patch: RankingSettingsPatch
): RankingSettings =>
  validateRankingSettings({
    version: RANKING_SETTINGS_VERSION,
    discussionHot: mergeHotRankingPatch(
      readRankingSettings(currentValue).discussionHot,
      patch.discussionHot
    ),
    commentHot: mergeHotRankingPatch(
      readRankingSettings(currentValue).commentHot,
      patch.commentHot
    ),
  });

export const serializeRankingSettings = (settings: RankingSettings) =>
  JSON.stringify(validateRankingSettings(settings));

export const getDiscussionHotRankingParams = (settings: RankingSettings) => ({
  hotAgeOffsetMonths: settings.discussionHot.ageOffsetMonths,
  hotGravity: settings.discussionHot.gravity,
});

export const getCommentHotRankingParams = (settings: RankingSettings) => ({
  hotAgeOffsetMonths: settings.commentHot.ageOffsetMonths,
  hotGravity: settings.commentHot.gravity,
});
