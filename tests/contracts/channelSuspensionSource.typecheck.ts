import type { ChannelUserSuspensionSource, ChannelModSuspensionSource } from "../../customResolvers/contracts/channelSuspensionSource.js";
import type { ActiveSuspensionResult } from "../../rules/permission/getActiveSuspension.js";
declare const user: ChannelUserSuspensionSource;
declare const mod: ChannelModSuspensionSource;
// @ts-expect-error a targeted channel user query does not select the moderator link
void user.SuspendedMod;
// @ts-expect-error a targeted channel moderator query does not select the user link
void mod.SuspendedUser;
// @ts-expect-error native identity properties have not passed String completion
const identity: string = user.SuspendedUser!.username;
// @ts-expect-error native issue properties have not passed Int completion
const issue: number = mod.RelatedIssue!.issueNumber;
// @ts-expect-error channel reads do not select server scope metadata
void user.serverName;
declare const result: ActiveSuspensionResult;
// @ts-expect-error classification does not validate the selected issue number
const classifiedIssue: number | null = result.relatedIssueNumber;
void [identity, issue, classifiedIssue];
