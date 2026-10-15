import { logger } from "../../logger.js";
// Disconnects expired suspensions from a channel.
// This keeps the Suspension nodes for historical display but removes
// them from the channel's active suspended users/mods lists.
import type { Driver } from "neo4j-driver";
import {
  createSuspensionEffectsRepository,
  type SuspensionEffectsRepository,
} from "../../services/persistence/suspensionEffectsRepository.js";

type SuspensionReference = { id: string };

type DisconnectExpiredSuspensionsInput = {
  driver: Driver;
  repository?: SuspensionEffectsRepository;
  channelUniqueName: string;
  expiredUserSuspensions: SuspensionReference[];
  expiredModSuspensions: SuspensionReference[];
};

type DisconnectExpiredSuspensionsResult = {
  disconnectedUserSuspensionIds: string[];
  disconnectedModSuspensionIds: string[];
};

export async function disconnectExpiredSuspensions(
  input: DisconnectExpiredSuspensionsInput
): Promise<DisconnectExpiredSuspensionsResult> {
  const { channelUniqueName, expiredUserSuspensions, expiredModSuspensions } =
    input;
  const userSuspensionIds = expiredUserSuspensions.map(({ id }) => id);
  const modSuspensionIds = expiredModSuspensions.map(({ id }) => id);

  if (userSuspensionIds.length > 0 || modSuspensionIds.length > 0) {
    try {
      const repository =
        input.repository ?? createSuspensionEffectsRepository(input.driver);
      await repository.disconnectExpiredChannelSuspensions({
        scopeName: channelUniqueName,
        userSuspensionIds,
        modSuspensionIds,
      });
    } catch (error) {
      logger.error("Error disconnecting expired suspensions", error);
    }
  }

  return {
    disconnectedUserSuspensionIds: userSuspensionIds,
    disconnectedModSuspensionIds: modSuspensionIds,
  };
}
