import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  UserCreateInput,
  UserUpdateInput,
} from "../../src/generated/graphql.js";
import {
  MAX_CHARS_IN_USERNAME,
  MAX_CHARS_IN_USER_DISPLAY_NAME,
  MAX_CHARS_IN_USER_BIO,
} from "./constants.js";

type UserInput = {
  username?: string | null;
  bio?: string | null;
  displayName?: string | null;
  isEditMode?: boolean | null;
};

// Role relationships must never be assigned through the generic updateUsers
// mutation: it is gated to `isAccountOwner` (self-only), so a user can edit
// their OWN user node. Without this guard a user could connect (or create) an
// elevated ServerRole/ModServerRole/ChannelRole/ModChannelRole on themselves
// and self-escalate to admin/mod. Role assignment must go through the dedicated
// invite/accept workflows (inviteServerAdmin, acceptServerModInvite, ...), which
// have their own permission checks. This is enforced for ALL callers because
// the generic role-connect path is not a legitimate flow.
const FORBIDDEN_USER_UPDATE_RELATIONSHIPS = [
  "ServerRoles",
  "ModServerRoles",
  "ChannelRoles",
  "ModChannelRoles",
] as const;

export const validateNoRoleRelationshipUpdates = (
  update: Record<string, unknown> | null | undefined
): true | string => {
  if (!update) {
    return true;
  }

  const attempted = FORBIDDEN_USER_UPDATE_RELATIONSHIPS.filter(
    (field) => update[field] !== undefined
  );

  if (attempted.length > 0) {
    return `Roles cannot be assigned through updateUsers (${attempted.join(
      ", "
    )}). Use the dedicated invite workflows instead.`;
  }

  return true;
};

export const validateUserInput = (input: UserInput): true | string => {
  const { username, bio, displayName, isEditMode } = input;

  if (!isEditMode) {
    if (!username) {
      return "A username is required.";
    }

    if (username.length > MAX_CHARS_IN_USERNAME) {
      return `The username cannot exceed ${MAX_CHARS_IN_USERNAME} characters.`;
    }

    // Allow only letters, numbers, and underscores in username; no spaces or special characters.
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return "The username can only contain letters, numbers, and underscores and cannot contain spaces or special characters.";
    }
  }

  if (bio && bio.length > MAX_CHARS_IN_USER_BIO) {
    return `The user bio cannot exceed ${MAX_CHARS_IN_USER_BIO} characters.`;
  }

  if (displayName && displayName.length > MAX_CHARS_IN_USER_DISPLAY_NAME) {
    return `The display name cannot exceed ${MAX_CHARS_IN_USER_DISPLAY_NAME} characters.`;
  }

  return true;
};

type CreateUserInput = { input: UserCreateInput[] };
export const createUserInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: CreateUserInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.input || !args.input[0]) {
      return "Missing or empty input in args.";
    }
    return validateUserInput({
      ...args.input[0],
      isEditMode: false,
    });
  }
);

type UpdateUserInput = { update: UserUpdateInput };
export const updateUserInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: UpdateUserInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.update) {
      return "Missing update input in args.";
    }
    const roleCheck = validateNoRoleRelationshipUpdates(
      args.update as Record<string, unknown>
    );
    if (roleCheck !== true) {
      return roleCheck;
    }
    return validateUserInput({
      ...args.update,
      isEditMode: true,
    });
  }
);
