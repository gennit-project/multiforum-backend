import type {
  ChannelUpdateInput,
  ChannelModel,
  UserModel,
} from "../../ogm_types.js";
import { sendEmailToUser, EmailContent } from "./shared/emailUtils.js";

type Args = {
  inviteeUsername: string;
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { Channel, User } = input;

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { channelUniqueName, inviteeUsername } = args;

    if (!channelUniqueName || !inviteeUsername) {
      throw new Error(
        "All arguments (channelUniqueName, inviteeUsername) are required"
      );
    }

    // Markdown-friendly message for in-app Notifications
    const notificationMessage = `
You have been invited to be a mod of the forum ${channelUniqueName}.
To accept it, go to [this page](${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite).
    `;

    // Email content (plain text + HTML)
    const emailContent: EmailContent = {
      subject: "You have been invited to be a mod of a forum",
      plainText: `You have been invited to be a mod of the forum "${channelUniqueName}".
To accept it, please visit this link:
${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite
`,
      html: `
<p>You have been invited to be a mod of the forum <strong>${channelUniqueName}</strong>.</p>
<p>To accept your invite, please click or copy/paste the link below:</p>
<p>
  <a href="${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite">
    ${process.env.FRONTEND_URL}/forums/${channelUniqueName}/accept-invite
  </a>
</p>
`
    };

    // Prepare the OGM update inputs
    const channelUpdateInput: ChannelUpdateInput = {
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
    };

    try {
      // Update the Channel (add the pending mod invite)
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
      console.error(e);
      return false;
    }
  };
};

export default getResolver;