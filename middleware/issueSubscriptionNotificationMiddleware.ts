import type { GraphQLResolveInfo } from "graphql";
import { notifyIssueSubscribers } from "../services/issueNotifications.js";

type Resolver = (
  parent: unknown,
  args: any,
  context: any,
  info: GraphQLResolveInfo
) => Promise<any>;

type IssueSubscriptionNotificationDependencies = {
  notifyIssueSubscribers?: typeof notifyIssueSubscribers;
};

export const getCreatedActivityNodes = (args: {
  update?: { ActivityFeed?: any[] };
  create?: { ActivityFeed?: any[] };
}): any[] => {
  const updatedActivityNodes = (
    Array.isArray(args?.update?.ActivityFeed) ? args.update.ActivityFeed : []
  ).flatMap((activityUpdate) => {
    const created = activityUpdate?.create;
    return Array.isArray(created)
      ? created.map((entry) => entry?.node).filter(Boolean)
      : [];
  });

  const createdActivityNodes = (
    Array.isArray(args?.create?.ActivityFeed) ? args.create.ActivityFeed : []
  )
    .map((activityCreate) => activityCreate?.node)
    .filter(Boolean);

  return [...updatedActivityNodes, ...createdActivityNodes];
};

export const createIssueSubscriptionNotificationMiddleware = (
  dependencies: IssueSubscriptionNotificationDependencies = {}
) => {
  const notifyIssueSubscribersFn =
    dependencies.notifyIssueSubscribers || notifyIssueSubscribers;

  return {
    Mutation: {
      updateIssues: async (
        resolve: Resolver,
        parent: unknown,
        args: {
          where?: { id?: string };
          update?: Record<string, any>;
          create?: Record<string, any>;
        },
        context: any,
        info: GraphQLResolveInfo
      ) => {
        const activityNodes = getCreatedActivityNodes(args);
        const result = await resolve(parent, args, context, info);
        const issueId = result?.issues?.[0]?.id || args?.where?.id;

        if (!issueId || !activityNodes.length) {
          return result;
        }

        for (const node of activityNodes) {
          await notifyIssueSubscribersFn({
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
};

export default createIssueSubscriptionNotificationMiddleware();
