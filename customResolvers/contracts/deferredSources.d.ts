import type { MutationResolvers, IssueActivityFeedItemResponseResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";

type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
type Output<R> = Awaited<ReturnType<Callable<R>>>;
type ListContainer<T> = 0 extends (1 & T) ? never : T extends null | undefined ? T : T extends readonly unknown[] ? unknown[] : never;
/** Checks generated call arguments and list-container nullability only. Opaque
 * items retain GraphQL's selection-time child completion; this is NOT a checked
 * generated item response and must not promote a deferred inventory entry. */
export type OpaqueListSource<R> = (...args: Parameters<Callable<R>>) => ListContainer<Output<R>>;
/** Delegation owns selection-specific completion, including errors. Its library
 * return is deliberately unknown, not asserted as a full generated entity list. */
type FieldMethodParameters<R> = Parameters<Callable<R>> extends [unknown, ...infer Rest] ? Rest : never;
type DelegatedListSource<R> = NonNullable<Output<R>> extends readonly unknown[]
  ? (...args: FieldMethodParameters<R>) => unknown : never;
type PayloadSource<T> = T extends null | undefined ? T : T extends {issues: unknown}
  ? {issues: DelegatedListSource<IssueActivityFeedItemResponseResolvers<GraphQLContext>["issues"]>} : never;
type Activity = MutationResolvers<GraphQLContext>["addIssueActivityFeedItem"];
export type DelegatedActivitySource = (...args: Parameters<Callable<Activity>>) => PayloadSource<Output<Activity>> | Promise<PayloadSource<Output<Activity>>>;
