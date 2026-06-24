import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import {
  ChannelCreateInput,
  ChannelUpdateInput,
} from "../../src/generated/graphql.js";
import {
  MAX_CHARS_IN_CHANNEL_NAME,
  MAX_CHARS_IN_DISPLAY_NAME,
  MAX_CHARS_IN_CHANNEL_DESCRIPTION,
} from "./constants.js";

type ChannelRule = {
  summary: string;
  detail: string;
}

type ChannelInput = {
  uniqueName?: string | null;
  description?: string | null;
  displayName?: string | null;
  rules?: string;
  isEditMode?: boolean | null;
};

export const validateChannelInput = (input: ChannelInput): true | string => {
  const { uniqueName, description, displayName, isEditMode } = input;

  if (!isEditMode) {
    if (!uniqueName) {
      return "A unique name is required.";
    }

    if (uniqueName.length > MAX_CHARS_IN_CHANNEL_NAME) {
      return `The unique name cannot exceed ${MAX_CHARS_IN_CHANNEL_NAME} characters.`;
    }

    // Allow only letters, numbers, and underscores in uniqueName; no spaces or special characters.
    if (!/^[a-zA-Z0-9_]+$/.test(uniqueName)) {
      return "The unique name can only contain letters, numbers, and underscores and cannot contain spaces or special characters.";
    }
  }

  if (description && description.length > MAX_CHARS_IN_CHANNEL_DESCRIPTION) {
    return `The description text cannot exceed ${MAX_CHARS_IN_CHANNEL_DESCRIPTION} characters.`;
  }

  if (displayName && displayName.length > MAX_CHARS_IN_DISPLAY_NAME) {
    return `The display name cannot exceed ${MAX_CHARS_IN_DISPLAY_NAME} characters.`;
  }

  // Rules will come in as a JSON string. We'll parse it to validate it.
  if (input.rules) {
    try {
      const rules = JSON.parse(input.rules);
      if (!Array.isArray(rules)) {
        return "The rules must be an array.";
      }
      // Make sure each rule has a summary.
      for (const rule of rules) {
        if (!rule.summary) {
          return "Each rule must have a summary.";
        }
      }
    } catch (e) {
      return "The rules must be a valid JSON array.";
    }
  }
  logger.info("channel input is valid");

  return true;
};

type CreateChannelInput = { input: ChannelCreateInput[] };
export const createChannelInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: CreateChannelInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.input || !args.input[0]) {
      return "Missing or empty input in args.";
    }
    return validateChannelInput({
      ...args.input[0],
      isEditMode: false,
    });
  }
);

type UpdateChannelInput = { update: ChannelUpdateInput };
export const updateChannelInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: UpdateChannelInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    logger.info("checking if update channel input is valid", args);
    if (!args.update) {
      return "Missing update input in args.";
    }
    return validateChannelInput({
      ...args.update,
      isEditMode: true,
    });
  }
);
