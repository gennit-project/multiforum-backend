import type { Driver } from "neo4j-driver";
import type { UserCreateInput } from "../../src/generated/graphql.js";
import { executeManagedWrite } from "../neo4jTransactions.js";
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
    NotificationsConnection?: {
      aggregate?: { count?: { nodes?: number | null } | null } | null;
    } | null;
  } | null;
};
export type CompleteRegistration = {
  emailAddress: string;
  // Called only when the verified email has no account. Returning an existing
  // account must not validate or overwrite a new username/birthday.
  createInput: () => UserCreateInput;
};
export interface AccountRegistrationRepository {
  completeRegistration(
    request: CompleteRegistration,
  ): Promise<RegisteredAccount>;
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
      NotificationsConnection(where: { node: { read: { eq: false } } }) { aggregate { count { nodes } } }
    }
  }
}`;

// Email.address and User.username are unique keys created by coreSchemaConstraints.
// MERGE covers a previously unseen email; the dependent SET acquires a write
// lock even for an existing email, serializing ownership checks and creation.
export const LOCK_REGISTRATION_EMAIL = `
  MERGE (email:Email {address: $emailAddress})
  SET email.address = email.address
  RETURN email.address AS address
`;
const REGISTRATION_OWNER = `
  MATCH (:Email {address: $emailAddress})-[:HAS_EMAIL]->(user:User)
  RETURN user.username AS username
  LIMIT 2
`;

export function createAccountRegistrationRepository(
  driver: Driver,
): AccountRegistrationRepository {
  return {
    async completeRegistration({ emailAddress, createInput }) {
      return executeManagedWrite(driver, async (transaction) => {
        await transaction.run(LOCK_REGISTRATION_EMAIL, { emailAddress });
        const owners = await transaction.run(REGISTRATION_OWNER, {
          emailAddress,
        });
        if (owners.records.length > 1)
          throw new Error(
            "Email is linked to multiple accounts; please contact support",
          );
        let username = owners.records[0]?.get("username") as string | undefined;
        if (owners.records.length && !username)
          throw new Error(
            "Existing account has no username; please contact support",
          );
        if (!username) {
          const input = createInput();
          username = input.username;
          const existing = await executeGeneratedOperation<{
            users: unknown[];
          }>(
            driver,
            EXISTING_USERNAME,
            { where: { username: { eq: username } } },
            transaction,
          );
          if (existing.users.length) throw new Error("Username already taken");
          // v7 create inputs cannot connect an existing Email. Create the user
          // through the generated schema, then link the locked email inside
          // this same transaction instead of nesting another Email creation.
          const accountInput = { ...input };
          delete accountInput.Email;
          await executeGeneratedOperation(
            driver,
            CREATE_ACCOUNT,
            { input: [accountInput] },
            transaction,
          );
          const linked = await transaction.run(
            `
            MATCH (email:Email {address: $emailAddress}), (user:User {username: $username})
            MERGE (email)-[:HAS_EMAIL]->(user)
            RETURN user.username AS username
          `,
            { emailAddress, username },
          );
          if (!linked.records.length)
            throw new Error("Error creating user and linking email");
        }
        const result = await executeGeneratedOperation<{
          users: RegisteredAccount[];
        }>(
          driver,
          CREATED_ACCOUNT,
          { where: { username: { eq: username } } },
          transaction,
        );
        if (!result.users[0])
          throw new Error("Error creating user and linking email");
        return result.users[0];
      });
    },
    async findExistingUsername(username) {
      const result = await executeGeneratedOperation<{ users: unknown[] }>(
        driver,
        EXISTING_USERNAME,
        { where: { username: { eq: username } } },
      );
      return result.users;
    },
    async findExistingEmail(address) {
      const result = await executeGeneratedOperation<{ emails: unknown[] }>(
        driver,
        EXISTING_EMAIL,
        { where: { address: { eq: address } } },
      );
      return result.emails;
    },
    async createAccount(input) {
      await executeGeneratedOperation(driver, CREATE_ACCOUNT, {
        input: [input],
      });
    },
    async findCreatedAccount(username) {
      const result = await executeGeneratedOperation<{
        users: RegisteredAccount[];
      }>(driver, CREATED_ACCOUNT, { where: { username: { eq: username } } });
      return result.users;
    },
    async findOwnAccountSummary(address) {
      const result = await executeGeneratedOperation<{
        emails: OwnAccountSummary[];
      }>(driver, OWN_ACCOUNT, { where: { address: { eq: address } } });
      return result.emails;
    },
  };
}
