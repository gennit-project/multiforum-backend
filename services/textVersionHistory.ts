import type {
  RecordTextVersionInput,
  VersionHistoryRepository,
} from "./persistence/versionHistoryRepository.js";

export type TrackTextVersionInput = RecordTextVersionInput;

/**
 * Record an authored TextVersion and connect it to its parent atomically.
 * Returns null when the body/author is empty or either graph node is missing.
 */
export const trackTextVersion = (
  repository: VersionHistoryRepository,
  input: TrackTextVersionInput
): Promise<string | null> => repository.recordTextVersion(input);
