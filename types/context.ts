import type { Driver } from "neo4j-driver";
import type { Request } from "express";
import type { OGM } from "@neo4j/graphql-ogm";
import type { ModelMap } from "../ogm_types.js";

/**
 * The OGM instance is generic over the generated {@link ModelMap}, which gives
 * `ogm.model("Comment")` etc. their concrete model types.
 */
export type Ogm = OGM<ModelMap>;

/** A moderation-profile reference carried on the request user. */
export type ContextModerationProfile = {
  displayName?: string | null;
  ModChannelRoles?: unknown[];
  ModServerRoles?: unknown[];
  [key: string]: unknown;
} | null;

/**
 * Role/profile data attached to the request user by the permission layer.
 * The commonly-read fields are typed; the index signature keeps the shape
 * tolerant of the other fields that rules populate and read lazily (this
 * replaces what used to be an untyped `any`).
 */
export type UserContextData = {
  ModerationProfile?: ContextModerationProfile;
  ServerRoles?: unknown[];
  ChannelRoles?: unknown[];
  ModeratedChannels?: Array<{ uniqueName?: string | null }>;
  AdminOfServers?: unknown[];
  [key: string]: unknown;
};

/**
 * The authenticated user as resolved by the permission layer
 * (`setUserDataOnContext`) and attached to {@link GraphQLContext.user}.
 */
export type UserDataOnContext = {
  username: string | null;
  email: string | null;
  email_verified: boolean;
  data: UserContextData | null;
};

/**
 * The Express request as seen by GraphQL resolvers and permission rules. A few
 * fields are attached by the context factory / permission layer at runtime.
 */
export type GraphQLRequest = Request & {
  isMutation?: boolean;
  jwtError?: Error;
};

/**
 * The context object shared by every GraphQL resolver and graphql-shield rule.
 * It is assembled by the Apollo `context` factory in `index.ts` and augmented
 * with `user` by the permission layer (`setUserDataOnContext`).
 *
 * `req` is optional: HTTP-driven resolvers always have it, but background
 * services (notifications, version history) invoke the same hooks with only
 * `ogm`/`driver` and no request. The auth layer already treats `req` as
 * possibly-absent (`req?.headers`, `if (context.req)`).
 */
export type GraphQLContext = {
  driver: Driver;
  ogm: Ogm;
  req?: GraphQLRequest;
  user?: UserDataOnContext;
  jwtError?: Error;
};
