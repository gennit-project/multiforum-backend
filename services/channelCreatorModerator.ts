import type { SubscriptionEngine } from "./subscriptionEngine.js";
import type { ChannelCreatorModeratorRepository } from "./persistence/channelCreatorModeratorRepository.js";
import { logger } from "../logger.js";

export interface ChannelCreatorModeratorService {
  assign(channelUniqueName: string, displayName: string): Promise<void>;
}

export function createChannelCreatorModeratorService(
  repository: ChannelCreatorModeratorRepository,
  publisher: Pick<SubscriptionEngine, "publish">
): ChannelCreatorModeratorService {
  return {
    async assign(channelUniqueName, displayName) {
      const event = await repository.connect(channelUniqueName, displayName);
      if (!event) return;
      // Publication is outside the managed transaction and its retry callback.
      // Match generated mutations: best effort, non-blocking, no write retry.
      const report = (error: unknown) => logger.warn("Moderator relationship publication failed", error);
      try {
        const pending = publisher.publish(event);
        if (pending) void pending.catch(report);
      } catch (error) {
        report(error);
      }
    },
  };
}
