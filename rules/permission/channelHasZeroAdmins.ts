import { ChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type CheckZeroAdminsInput = {
  channelName: string;
  context: GraphQLContext;
};

export const channelHasZeroAdmins = async (input: CheckZeroAdminsInput): Promise<boolean> => {
  const { channelName, context } = input;
  
  const Channel = context.ogm.model("Channel");
  
  try {
    const channel = await Channel.find({
      where: {
        uniqueName: channelName,
      },
      selectionSet: `{ 
        Admins {
          username
        }
      }`,
    });

    if (!channel || !channel[0]) {
      return false; // Channel doesn't exist, so can't become admin
    }

    const channelData = channel[0];
    const admins = channelData.Admins || [];
    
    return admins.length === 0;
  } catch (error) {
    logger.error("Error checking if channel has zero admins:", error);
    return false;
  }
};