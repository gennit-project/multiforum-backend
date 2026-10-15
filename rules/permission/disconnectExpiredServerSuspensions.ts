import type { GraphQLContext } from "../../types/context.js";
import { createSuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";

type SuspensionReference = { id: string };

type DisconnectExpiredServerSuspensionsInput = {
  context: GraphQLContext;
  expiredUserSuspensions: SuspensionReference[];
  expiredModSuspensions: SuspensionReference[];
};

export async function disconnectExpiredServerSuspensions(
  input: DisconnectExpiredServerSuspensionsInput
) {
  const { context, expiredUserSuspensions, expiredModSuspensions } = input;
  const userSuspensionIds = expiredUserSuspensions.map(({ id }) => id);
  const modSuspensionIds = expiredModSuspensions.map(({ id }) => id);

  if (userSuspensionIds.length === 0 && modSuspensionIds.length === 0) {
    return {
      disconnectedUserSuspensionIds: [],
      disconnectedModSuspensionIds: [],
    };
  }

  const repository =
    context.suspensionEffectsRepository ??
    createSuspensionEffectsRepository(context.driver);
  await repository.disconnectExpiredServerSuspensions({
    scopeName: process.env.SERVER_CONFIG_NAME ?? "",
    userSuspensionIds,
    modSuspensionIds,
  });

  return {
    disconnectedUserSuspensionIds: userSuspensionIds,
    disconnectedModSuspensionIds: modSuspensionIds,
  };
}
