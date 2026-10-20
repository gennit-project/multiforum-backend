import type { Driver } from "neo4j-driver";
import type { Request } from "express";
import type { OGM } from "@neo4j/graphql-ogm";
import type { ModelMap } from "../ogm_types.js";
import type { PermissionServerConfigRepository } from "../services/persistence/permissionServerConfigRepository.js";
import type { SuspensionEffectsRepository } from "../services/persistence/suspensionEffectsRepository.js";
import type { ContentChannelPermissionRepository } from "../services/persistence/contentChannelPermissionRepository.js";
import type { ChannelPermissionRepository } from "../services/persistence/channelPermissionRepository.js";
import type { ContentAuthorizationRepository } from "../services/persistence/contentAuthorizationRepository.js";
import type { CommentCreationAuthorizationRepository } from "../services/persistence/commentCreationAuthorizationRepository.js";
import type { ContentFeaturePolicyRepository } from "../services/persistence/contentFeaturePolicyRepository.js";
import type { RequestIdentityRepository } from "../services/persistence/requestIdentityRepository.js";
import type { DownloadableFileRepository } from "../services/persistence/downloadableFileRepository.js";

/**
 * Compatibility surface for code not yet migrated to repositories. New domain
 * interfaces must use the application-owned repository contract instead.
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
  /**
   * Private, request-scoped age-attestation data used only by the server's
   * sensitive-content policy. This value must never be returned to clients.
   * `undefined` means an older/pre-seeded context still needs a DB lookup;
   * `null` means identity resolution confirmed that no birthday is stored.
   */
  dateOfBirth?: string | null;
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
  /** Optional application-owned override used by permission rules and tests. */
  permissionServerConfigRepository?: PermissionServerConfigRepository;
  /** Optional persistence seam for suspension cleanup and notifications. */
  suspensionEffectsRepository?: SuspensionEffectsRepository;
  /** Optional persistence seam for content-to-channel authorization reads. */
  contentChannelPermissionRepository?: ContentChannelPermissionRepository;
  /** Optional persistence seam for channel roles and suspension reads. */
  channelPermissionRepository?: ChannelPermissionRepository;
  /** Optional persistence seam for entity-level authorization reads. */
  contentAuthorizationRepository?: ContentAuthorizationRepository;
  /** Optional persistence seam for comment-creation target authorization reads. */
  commentCreationAuthorizationRepository?: CommentCreationAuthorizationRepository;
  /** Optional persistence seam for channel and server content feature policies. */
  contentFeaturePolicyRepository?: ContentFeaturePolicyRepository;
  /** Optional persistence seam for authenticated identity and ownership reads. */
  requestIdentityRepository?: RequestIdentityRepository;
  /** Optional persistence seam for download authorization and metadata reads. */
  downloadableFileRepository?: DownloadableFileRepository;
  req?: GraphQLRequest;
  user?: UserDataOnContext;
  jwtError?: Error;
  /** Request-scoped result of the server's sensitive-content age policy. */
  mayAccessSensitiveContent?: boolean;
  /** Claims consumed internally by Neo4j GraphQL authorization directives. */
  jwt?: Record<string, unknown>;
  /**
   * A verified workload identity accepted only by the plugin-configuration
   * reconciliation permission rule. It is not a Multiforum user.
   */
  pluginConfigurationAutomation?: {
    subject: string;
    scope: string;
  };
};
