import type { Driver } from "neo4j-driver";
import type { UserCreateInput } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type RegisteredAccount = {
  username: string;
  Email?: { address: string } | null;
  ModerationProfile?: { displayName: string } | null;
};
export type OwnAccountSummary = {
  address?: string | null;
  User?: {
    username?: string | null;
    profilePicURL?: string | null;
    ModerationProfile?: { displayName?: string | null } | null;
    NotificationsAggregate?: { count?: number | null } | null;
  } | null;
};
export interface AccountRegistrationRepository {
  findExistingUsername(username: string): Promise<unknown[]>;
  findExistingEmail(address: string): Promise<unknown[]>;
  createAccount(input: UserCreateInput): Promise<void>;
  findCreatedAccount(username: string): Promise<RegisteredAccount[]>;
  findOwnAccountSummary(address: string): Promise<OwnAccountSummary[]>;
}

// Registration historically selects every default scalar on existence reads
// and creation. Keep fields whose serialization errors can stop this workflow.
export const REGISTRATION_USER_SELECTION = `{
  username displayName pronouns location bio profilePicURL
  avatar32Url avatar48Url avatar64Url avatar96Url
  enableSensitiveContentByDefault isBot botProfileId isDeprecated deprecatedReason
  commentKarma discussionKarma stripeAccountId defaultEmojiSkinTone preferredTimeZone
  deleted notifyOnReplyToCommentByDefault notifyOnReplyToDiscussionByDefault
  notifyOnReplyToEventByDefault notifyWhenTagged notifyOnSubscribedIssueUpdates
  notifyOnFeedback notifyOnSuspensionBlocks notificationBundleInterval
  notificationBundleEnabled notificationBundleContent variantUrls createdAt
}`;
const EXISTING_USERNAME = `query ExistingRegistrationUsername($where: UserWhere) {
  users(where: $where) ${REGISTRATION_USER_SELECTION}
}`;
const EXISTING_EMAIL = `query ExistingRegistrationEmail($where: EmailWhere) {
  emails(where: $where) { address }
}`;
const CREATE_ACCOUNT = `mutation RegisterAccount($input: [UserCreateInput!]!) {
  createUsers(input: $input) { users ${REGISTRATION_USER_SELECTION} }
}`;
const CREATED_ACCOUNT = `query RegisteredAccount($where: UserWhere) {
  users(where: $where) {
    username Email { address } ModerationProfile { displayName }
  }
}`;
const OWN_ACCOUNT = `query OwnAccountSummary($where: EmailWhere) {
  emails(where: $where) {
    address
    User {
      username profilePicURL ModerationProfile { displayName }
      NotificationsAggregate(where: { read: false }) { count }
    }
  }
}`;

export function createAccountRegistrationRepository(driver: Driver): AccountRegistrationRepository {
  return {
    async findExistingUsername(username) {
      const result = await executeGeneratedOperation<{users: unknown[]}>(
        driver, EXISTING_USERNAME, {where: {username}}
      );
      return result.users;
    },
    async findExistingEmail(address) {
      const result = await executeGeneratedOperation<{emails: unknown[]}>(
        driver, EXISTING_EMAIL, {where: {address}}
      );
      return result.emails;
    },
    async createAccount(input) {
      await executeGeneratedOperation(driver, CREATE_ACCOUNT, {input: [input]});
    },
    async findCreatedAccount(username) {
      const result = await executeGeneratedOperation<{users: RegisteredAccount[]}>(
        driver, CREATED_ACCOUNT, {where: {username}}
      );
      return result.users;
    },
    async findOwnAccountSummary(address) {
      const result = await executeGeneratedOperation<{emails: OwnAccountSummary[]}>(
        driver, OWN_ACCOUNT, {where: {address}}
      );
      return result.emails;
    },
  };
}
