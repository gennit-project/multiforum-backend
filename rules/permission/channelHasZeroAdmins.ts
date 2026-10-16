import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import { createChannelPermissionRepository } from "../../services/persistence/channelPermissionRepository.js";

type CheckZeroAdminsInput = {
  channelName: string;
  context: GraphQLContext;
};

export const channelHasZeroAdmins = async (
  input: CheckZeroAdminsInput
): Promise<boolean> => {
  const { channelName, context } = input;

  try {
    const repository =
      context.channelPermissionRepository ??
      createChannelPermissionRepository(context.driver);
    const channel = await repository.findAuthorizationSnapshot(channelName);

    if (!channel) {
      return false; // Channel doesn't exist, so can't become admin
    }

    const admins = channel.Admins || [];

    return admins.length === 0;
  } catch (error) {
    logger.error("Error checking if channel has zero admins:", error);
    return false;
  }
};
