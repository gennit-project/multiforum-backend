import type {
  ServerConfigUpdateInput,
  ServerConfigModel,
  UserModel,
} from "../../ogm_types.js";
import { sendEmailToUser, EmailContent } from "./shared/emailUtils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  inviteeUsername: string;
  serverName: string;
};

type Input = {
  ServerConfig: ServerConfigModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { ServerConfig, User } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { serverName, inviteeUsername } = args;

    if (!serverName || !inviteeUsername) {
      throw new Error(
        "All arguments (serverName, inviteeUsername) are required"
      );
    }

    // Markdown-friendly message for in-app Notifications:
    const notificationMessage = `
You have been invited to be a server moderator.
To accept it, go to [this page](${process.env.FRONTEND_URL}/admin/accept-mod-invite).
`;

    // Non-Markdown email text (plain text) and HTML
    const emailContent: EmailContent = {
      subject: "You have been invited to be a server moderator",
      plainText: `You have been invited to be a server moderator.
To accept it, please visit this link:
${process.env.FRONTEND_URL}/admin/accept-mod-invite
`,
      html: `
<p>You have been invited to be a server moderator.</p>
<p>To accept your invite, please click or copy/paste the link below:</p>
<p><a href="${process.env.FRONTEND_URL}/admin/accept-mod-invite">${process.env.FRONTEND_URL}/admin/accept-mod-invite</a></p>
`
    };

    // Prepare the OGM update inputs
    // Note: Using type assertion until OGM types are regenerated
    const serverConfigUpdateInput = {
      PendingModInvites: [
        {
          connect: [
            {
              where: {
                node: {
                  username: inviteeUsername,
                },
              },
            },
          ],
        },
      ],
    } as ServerConfigUpdateInput;

    try {
      // Update the ServerConfig to add the user to the list of pending invites
      const serverConfigUpdateResult = await ServerConfig.update({
        where: {
          serverName: serverName,
        },
        update: serverConfigUpdateInput,
      });
      if (!serverConfigUpdateResult.serverConfigs[0]) {
        throw new Error("Could not invite user.");
      }

      // Send email and create notification
      const emailSent = await sendEmailToUser(
        inviteeUsername,
        emailContent,
        User,
        {
          inAppText: notificationMessage,
          createInAppNotification: true
        }
      );

      return emailSent;
    } catch (e) {
      console.error(e);
      return false;
    }
  };
};

export default getResolver;
