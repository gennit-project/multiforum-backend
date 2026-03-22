import type { GraphQLResolveInfo } from "graphql";
import { notifyIssueSubscribers } from "../services/issueNotifications.js";

type Resolver = (
  parent: unknown,
  args: any,
  context: any,
  info: GraphQLResolveInfo
) => Promise<any>;

const getCreatedActivityNodes = (update: any): any[] => {
  const activityFeedUpdates = update?.ActivityFeed;
  if (!Array.isArray(activityFeedUpdates)) {
    return [];
  }

  return activityFeedUpdates.flatMap((activityUpdate) => {
    const created = activityUpdate?.create;
    return Array.isArray(created)
      ? created.map((entry) => entry?.node).filter(Boolean)
      : [];
  });
};

const issueSubscriptionNotificationMiddleware = {
  Mutation: {
    updateIssues: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string }; update?: Record<string, any> },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const activityNodes = getCreatedActivityNodes(args?.update);
      const result = await resolve(parent, args, context, info);
      const issueId = result?.issues?.[0]?.id || args?.where?.id;

      if (!issueId || !activityNodes.length) {
        return result;
      }

      for (const node of activityNodes) {
        await notifyIssueSubscribers({
          IssueModel: context?.ogm?.model("Issue"),
          driver: context?.driver,
          issueId,
          actorUsername: context?.user?.username || null,
          actionType: node?.actionType || null,
          actionDescription: node?.actionDescription || "updated the issue",
          commentText: node?.Comment?.create?.node?.text || null,
        });
      }

      return result;
    },
  },
};

export default issueSubscriptionNotificationMiddleware;
