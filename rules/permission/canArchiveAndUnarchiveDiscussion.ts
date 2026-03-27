import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { rule } from "graphql-shield";

export const canArchiveAndUnarchiveDiscussion = rule({ cache: "contextual" })(
  async (parent: any, args: any, context: any, info: any) => {
    let channelUniqueName = args.channelUniqueName;
    // Support both direct issueId arg and where.id from updateIssues mutation
    const issueId = args.issueId || args.where?.id;

    console.log('can archive and unarchive discussion');
    console.log("channelUniqueName", channelUniqueName);
    console.log("issueId", issueId);

    // If channelUniqueName is not provided, look it up from the issue
    if (!channelUniqueName && issueId) {
      const Issue = context.ogm.model("Issue");
      const issue = await Issue.find({
        where: { id: issueId },
        selectionSet: `{ 
          channelUniqueName
        }`,
      });

      if (!issue || !issue[0]) {
        return new Error("Could not find the issue or its associated channel.");
      }

      channelUniqueName = issue[0].channelUniqueName;
    }

    if (!channelUniqueName) {
      return new Error("No channel specified for this operation.");
    }
    
    // Check if the user has the required permission in the specified channel
    const permissionResult = await checkChannelModPermissions({
        channelConnections: [channelUniqueName],
        context,
        permissionCheck: ModChannelPermission.canHideDiscussion
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
