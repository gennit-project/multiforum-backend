import type {
  ChannelUpdateInput,
  ChannelModel,
  UserModel,
} from "../../ogm_types.js";
import { sendEmailToUser, EmailContent } from "./shared/emailUtils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  inviteeUsername: string;
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { Channel, User } = input; // This refers to the OGM model

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, inviteeUsername } = args;

    if (!channelUniqueName || !inviteeUsername) {
      throw new Error(
        "All arguments (channelUniqueName, inviteeUsername) are required"
      );
    }

    // Markdown-friendly message for in-app Notifications:
    const notificationMessage = `
You have been invited to be an owner of the forum ${channelUniqueName}.
To accept it, go to [this page](${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite).
`;

    // Non-Markdown email text (plain text) and HTML
    const emailContent: EmailContent = {
      subject: "You have been invited to be an owner of a forum",
      plainText: `You have been invited to be an owner of the forum "${channelUniqueName}".
To accept it, please visit this link:
${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite
`,
      html: `
<p>You have been invited to be an owner of the forum <strong>${channelUniqueName}</strong>.</p>
<p>To accept your invite, please click or copy/paste the link below:</p>
<p><a href="${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite">${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite</a></p>
`
    };

    // Prepare the OGM update inputs
    const channelUpdateInput: ChannelUpdateInput = {
      PendingOwnerInvites: [
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
    };

    try {
      // Update the Channel to add the user to the list of pending invites
      const channelUpdateResult = await Channel.update({
        where: {
          uniqueName: channelUniqueName,
        },
        update: channelUpdateInput,
      });
      if (!channelUpdateResult.channels[0]) {
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
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
