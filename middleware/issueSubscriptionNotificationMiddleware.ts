import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { notifyIssueSubscribers } from "../services/issueNotifications.js";

type Resolver = (
  parent: unknown,
  args: unknown,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<{ issues?: { id?: string }[] } | undefined>;

type IssueSubscriptionNotificationDependencies = {
  notifyIssueSubscribers?: typeof notifyIssueSubscribers;
};

type ActivityNode = {
  actionType?: string | null;
  actionDescription?: string | null;
  Comment?: { create?: { node?: { text?: string | null } | null } | null } | null;
  [key: string]: unknown;
};

type ActivityUpdateEntry = {
  create?: Array<{ node?: ActivityNode | null } | null> | null;
  [key: string]: unknown;
};

type ActivityCreateEntry = {
  node?: ActivityNode | null;
  [key: string]: unknown;
};

type UpdateIssuesActivityArgs = {
  where?: { id?: string };
  update?: { ActivityFeed?: ActivityUpdateEntry[]; [key: string]: unknown };
  create?: { ActivityFeed?: ActivityCreateEntry[]; [key: string]: unknown };
};

export const getCreatedActivityNodes = (args: UpdateIssuesActivityArgs): ActivityNode[] => {
  const updatedActivityNodes = (
    Array.isArray(args?.update?.ActivityFeed) ? args.update.ActivityFeed : []
  ).flatMap((activityUpdate: ActivityUpdateEntry) => {
    const created = activityUpdate?.create;
    return Array.isArray(created)
      ? created
          .map((entry) => entry?.node)
          .filter((node): node is ActivityNode => Boolean(node))
      : [];
  });

  const createdActivityNodes = (
    Array.isArray(args?.create?.ActivityFeed) ? args.create.ActivityFeed : []
  )
    .map((activityCreate: ActivityCreateEntry) => activityCreate?.node)
    .filter((node): node is ActivityNode => Boolean(node));

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
        args: UpdateIssuesActivityArgs,
        context: GraphQLContext,
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
