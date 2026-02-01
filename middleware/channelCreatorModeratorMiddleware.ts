import { GraphQLResolveInfo } from 'graphql';
import { setUserDataOnContext } from '../rules/permission/userDataHelperFunctions.js';

interface CreateChannelsArgs {
  input?: any[];
  [key: string]: any;
}

interface Context {
  ogm: any;
  driver: any;
  [key: string]: any;
}

interface CreateChannelsResult {
  channels?: Array<{
    uniqueName: string;
    [key: string]: any;
  }>;
  [key: string]: any;
}

const channelCreatorModeratorMiddleware = {
  Mutation: {
    createChannels: async (
      resolve: (parent: unknown, args: CreateChannelsArgs, context: Context, info: GraphQLResolveInfo) => Promise<CreateChannelsResult>,
      parent: unknown,
      args: CreateChannelsArgs,
      context: Context,
      info: GraphQLResolveInfo
    ): Promise<CreateChannelsResult> => {
      // 1. Execute original resolver to create the channel(s)
      const result = await resolve(parent, args, context, info);

      // 2. Get logged-in user's ModerationProfile displayName
      try {
        const userData = await setUserDataOnContext({
          context: context as unknown as { ogm: any; req: any; jwtError?: any },
          getPermissionInfo: false,
        });

        if (!userData?.username) {
          console.warn('⚠️ No logged-in user found for channel creation, skipping moderator assignment');
          return result;
        }

        const User = context.ogm.model('User');
        const userWithProfile = await User.find({
          where: { username: userData.username },
          selectionSet: `{
            ModerationProfile {
              displayName
            }
          }`,
        });

        const displayName = userWithProfile[0]?.ModerationProfile?.displayName;

        if (!displayName) {
          console.warn(`⚠️ User ${userData.username} has no ModerationProfile, skipping moderator assignment`);
          return result;
        }

        // 3. For each created channel, add creator as moderator
        const channels = result?.channels;
        if (!channels || channels.length === 0) {
          return result;
        }

        const Channel = context.ogm.model('Channel');

        for (const channel of channels) {
          if (!channel?.uniqueName) {
            continue;
          }

          try {
            await Channel.update({
              where: { uniqueName: channel.uniqueName },
              update: {
                Moderators: [
                  {
                    connect: [
                      {
                        where: {
                          node: {
                            displayName,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            });

            console.log(`✅ Added creator ${displayName} as moderator of channel ${channel.uniqueName}`);
          } catch (error) {
            // Log the error but don't fail the channel creation
            console.error(
              `❌ Failed to add creator as moderator for channel ${channel.uniqueName}:`,
              (error as any)?.message || error
            );
          }
        }
      } catch (error) {
        // Log the error but don't fail the channel creation
        console.warn(
          '⚠️ Failed to add creator as moderator:',
          (error as any)?.message || error
        );
      }

      return result;
    },
  },
};

export default channelCreatorModeratorMiddleware;
