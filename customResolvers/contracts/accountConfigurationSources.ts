import { rememberCanonicalSource } from "../../services/canonicalSourceFields.js";
import type { RankingSettings } from "../../services/rankingSettings.js";

/** Normalized domain values, not caller-selected database response keys. */
export function rankingSettingsSource(source: RankingSettings & {updatedAt: string | null; updatedBy: string | null}) {
  return rememberCanonicalSource({
    version: source.version,
    discussionHot: rememberCanonicalSource({ageOffsetMonths: source.discussionHot.ageOffsetMonths, gravity: source.discussionHot.gravity}),
    commentHot: rememberCanonicalSource({ageOffsetMonths: source.commentHot.ageOffsetMonths, gravity: source.commentHot.gravity}),
    updatedAt: source.updatedAt,
    updatedBy: source.updatedBy,
  });
}
