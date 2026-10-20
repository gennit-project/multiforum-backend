import { createServerInvitationRepository, type ServerInvitationRepository } from "../../services/persistence/serverInvitationRepository.js";
import type { Driver } from "neo4j-driver";
import { createEmailNotificationRepository } from "../../services/persistence/emailNotificationRepository.js";
import { sendEmailToUser, EmailContent } from "./shared/emailUtils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  inviteeUsername: string;
  serverName: string;
};

type Input = {
  driver: Driver;
  emailDelivery?: Parameters<typeof sendEmailToUser>[2];
  serverInvitationRepository?: ServerInvitationRepository;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.serverInvitationRepository ?? createServerInvitationRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { serverName, inviteeUsername } = args;

    if (!serverName || !inviteeUsername) {
      throw new Error(
        "All arguments (serverName, inviteeUsername) are required"
      );
    }

    const invitees = await repository.findInvitee(inviteeUsername);
    if (!invitees[0]) {
      throw new Error(`No user exists with username "${inviteeUsername}".`);
    }

    // Markdown-friendly message for in-app Notifications:
    const notificationMessage = `
You have been invited to be a server admin.
To accept it, go to [this page](${process.env.FRONTEND_URL}/admin/accept-admin-invite).
`;

    // Non-Markdown email text (plain text) and HTML
    const emailContent: EmailContent = {
      subject: "You have been invited to be a server admin",
      plainText: `You have been invited to be a server admin.
To accept it, please visit this link:
${process.env.FRONTEND_URL}/admin/accept-admin-invite
`,
      html: `
<p>You have been invited to be a server admin.</p>
<p>To accept your invite, please click or copy/paste the link below:</p>
<p><a href="${process.env.FRONTEND_URL}/admin/accept-admin-invite">${process.env.FRONTEND_URL}/admin/accept-admin-invite</a></p>
`
    };


    // Update the ServerConfig to add the user to the list of pending invites.
    const serverConfigUpdateResult = await repository.connectAdminInvite(serverName, inviteeUsername);
    if (!serverConfigUpdateResult.serverConfigs[0]) {
      throw new Error(`No server exists with name "${serverName}".`);
    }

    // Delivery is best-effort. The invitation itself succeeded once the
    // PendingAdminInvites relationship was created.
    await sendEmailToUser(inviteeUsername, emailContent, input.emailDelivery ?? {emailNotificationRepository: createEmailNotificationRepository(driver)}, {
      inAppText: notificationMessage,
      createInAppNotification: true,
    });

    return true;
  };
};

export default getResolver;
