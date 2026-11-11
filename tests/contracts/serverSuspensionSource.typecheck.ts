import type { ServerSuspensionSource, ServerUserSuspensionSource } from "../../customResolvers/contracts/serverSuspensionSource.js";
import type { ActiveServerSuspensionResult } from "../../rules/permission/activeServerSuspensionTypes.js";
declare const source: ServerSuspensionSource;
// @ts-expect-error raw issue numbers have not passed GraphQL Int completion
const issue: number = source.RelatedIssue!.issueNumber;
// @ts-expect-error stored indefinite flags are not known Booleans
const flag: boolean = source.suspendedIndefinitely;
// @ts-expect-error raw identifiers are not schema-completed IDs
const id: string = source.id;
// @ts-expect-error the targeted read does not fetch a full generated Suspension
void source.createdAt;
// @ts-expect-error native user read always constructs all its selected containers
const missing: ServerUserSuspensionSource = { id: "suspension" };
const date: string | null = source.suspendedUntil;
declare const cached: ActiveServerSuspensionResult;
// @ts-expect-error caching cannot turn an unvalidated issue number into Int
const cachedIssue: number | null = cached.relatedIssueNumber;
void [issue, flag, id, missing, date, cachedIssue];
