import { GraphQLError } from "graphql";

export const MAX_DISCUSSION_FLAIR_NAME_LENGTH = 40;

const HEX_COLOR = /^#[0-9A-F]{6}$/;

export type DiscussionFlairConfigInput = {
  id?: string | null;
  displayName: string;
  color?: string | null;
  order: number;
  archived?: boolean | null;
};

export type NormalizedDiscussionFlairConfig = {
  id?: string;
  displayName: string;
  color: string | null;
  order: number;
  archived: boolean;
};

const normalizeDisplayName = (displayName: string) =>
  displayName.normalize("NFKC").trim().replace(/\s+/g, " ");

const comparisonKey = (displayName: string) =>
  normalizeDisplayName(displayName).toLocaleLowerCase("en-US");

export const normalizeDiscussionFlairConfig = (
  flairs: DiscussionFlairConfigInput[],
  flairRequired: boolean
): NormalizedDiscussionFlairConfig[] => {
  if (!Array.isArray(flairs)) {
    throw new GraphQLError("Flairs must be provided as a list.");
  }

  const ids = new Set<string>();
  const activeNames = new Set<string>();
  const activeOrders = new Set<number>();

  const normalized = flairs.map((flair, index) => {
    const displayName = normalizeDisplayName(flair.displayName ?? "");
    if (!displayName) {
      throw new GraphQLError(`Flair ${index + 1} must have a display name.`);
    }
    if (displayName.length > MAX_DISCUSSION_FLAIR_NAME_LENGTH) {
      throw new GraphQLError(
        `Flair display names cannot exceed ${MAX_DISCUSSION_FLAIR_NAME_LENGTH} characters.`
      );
    }

    const id = flair.id?.trim() || undefined;
    if (id) {
      if (ids.has(id)) {
        throw new GraphQLError(`Duplicate flair ID '${id}'.`);
      }
      ids.add(id);
    }

    if (!Number.isInteger(flair.order) || flair.order < 0) {
      throw new GraphQLError("Flair order must be a non-negative integer.");
    }

    const color = flair.color?.trim().toUpperCase() || null;
    if (color && !HEX_COLOR.test(color)) {
      throw new GraphQLError(
        "Flair colors must be six-digit hexadecimal values such as #2563EB."
      );
    }

    const archived = flair.archived === true;
    if (!archived) {
      const nameKey = comparisonKey(displayName);
      if (activeNames.has(nameKey)) {
        throw new GraphQLError(
          `Active flair names must be unique. '${displayName}' appears more than once.`
        );
      }
      activeNames.add(nameKey);

      if (activeOrders.has(flair.order)) {
        throw new GraphQLError(
          `Active flair order values must be unique. Order ${flair.order} appears more than once.`
        );
      }
      activeOrders.add(flair.order);
    }

    return {
      id,
      displayName,
      color,
      order: flair.order,
      archived,
    };
  });

  if (flairRequired && !normalized.some((flair) => !flair.archived)) {
    throw new GraphQLError(
      "At least one active flair is required before flair selection can be required."
    );
  }

  return normalized;
};
