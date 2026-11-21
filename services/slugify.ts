/**
 * URL slug helpers for the "number + decorative slug" route scheme
 * (e.g. `/forums/cats/discussions/42-trail-conditions`).
 *
 * The slug is purely cosmetic: route lookups resolve against the leading
 * canonical number and ignore the slug text, so the slug never needs to be
 * stored, unique, or stable. `slugify` is deterministic so the backend's
 * notification/email links match the frontend's generated links.
 */

const DEFAULT_MAX_LENGTH = 60;

/**
 * Turn an arbitrary title into a lowercase, hyphenated, ASCII-ish slug.
 * Strips diacritics, collapses any run of non-alphanumerics to a single
 * hyphen, trims leading/trailing hyphens, and caps the length without
 * leaving a dangling partial-word hyphen. Returns "" for empty/untitled input.
 */
export const slugify = (
  input: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH
): string => {
  if (!input) return "";

  const normalized = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any non-alphanumeric run -> single hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/-+$/g, "");
};

/**
 * Build the decorative URL segment from a canonical id and an optional title:
 *   buildSlugSegment(42, "Trail conditions") -> "42-trail-conditions"
 *   buildSlugSegment(42, "")                 -> "42"
 * The number is always the canonical identifier; the slug is appended only
 * when the title yields one.
 */
export const buildSlugSegment = (
  id: number | string,
  title?: string | null,
  maxLength: number = DEFAULT_MAX_LENGTH
): string => {
  const slug = slugify(title, maxLength);
  return slug ? `${id}-${slug}` : `${id}`;
};

/**
 * Parse the canonical leading integer out of a route segment, ignoring any
 * decorative slug suffix: parseSlugSegmentNumber("42-trail-conditions") -> 42.
 * Returns null when the segment does not start with a positive integer.
 */
export const parseSlugSegmentNumber = (
  segment: string | null | undefined
): number | null => {
  if (!segment) return null;
  const match = /^(\d+)/.exec(segment.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) ? value : null;
};
