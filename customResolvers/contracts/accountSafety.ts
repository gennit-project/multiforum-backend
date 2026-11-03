import type { MutationResolvers, QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";

export const accountSafetyMutationNames = ["setMyBirthday", "createSignedStorageURL"] as const;
export const accountSafetyQueryNames = ["getMyAgeProfile", "getDiscussionAgeGateCheck", "safetyCheck"] as const;
export const ageProfileSelection = { birthday: true, meetsAccountMinimumAge: true, mayAccessSensitiveContent: true } as const;
export const ageCheckSelection = { requiresAgeCheck: true, status: true, minimumAge: true } as const;
export const safetyCheckSelection = { environment: { isTestEnvironment: true, currentDatabase: true } } as const;
export type AccountSafetyMutationResolvers = {
  createSignedStorageURL: NonNullable<MutationResolvers<GraphQLContext>["createSignedStorageURL"]>;
  setMyBirthday: SelectedResolver<MutationResolvers<GraphQLContext>["setMyBirthday"], typeof ageProfileSelection>;
};
export type AccountSafetyQueryResolvers = {
  getMyAgeProfile: SelectedResolver<QueryResolvers<GraphQLContext>["getMyAgeProfile"], typeof ageProfileSelection>;
  getDiscussionAgeGateCheck: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionAgeGateCheck"], typeof ageCheckSelection>;
  safetyCheck: SelectedResolver<QueryResolvers<GraphQLContext>["safetyCheck"], typeof safetyCheckSelection>;
};
