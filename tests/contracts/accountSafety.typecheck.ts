import createSignedStorageURL from "../../customResolvers/mutations/createSignedStorageURL.js";
// Compile-only negative and implementation fixtures.
import type { Driver } from "neo4j-driver";
import type { AccountSafetyMutationResolvers, AccountSafetyQueryResolvers } from "../../customResolvers/contracts/accountSafety.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import setMyBirthday from "../../customResolvers/mutations/setMyBirthday.js";
import getMyAgeProfile from "../../customResolvers/queries/getMyAgeProfile.js";
import getDiscussionAgeGateCheck from "../../customResolvers/queries/getDiscussionAgeGateCheck.js";
import safetyCheck from "../../customResolvers/queries/safetyCheck.js";
declare const driver: Driver;
const agePolicyRepository = createInstancePolicyRepository(driver);
const mutations = { createSignedStorageURL: createSignedStorageURL(), setMyBirthday: setMyBirthday({driver, agePolicyRepository}) } satisfies AccountSafetyMutationResolvers;
const queries = { getMyAgeProfile: getMyAgeProfile({driver, agePolicyRepository}), getDiscussionAgeGateCheck: getDiscussionAgeGateCheck({driver, agePolicyRepository}), safetyCheck } satisfies AccountSafetyQueryResolvers;
// @ts-expect-error enum membership is restricted to schema values
const wrongStatus: AccountSafetyQueryResolvers["getDiscussionAgeGateCheck"] = () => ({ requiresAgeCheck: true, status: "MAYBE", minimumAge: 18 });
// @ts-expect-error public age eligibility is a Boolean, not a numeric flag
const wrongEligibility: AccountSafetyMutationResolvers["setMyBirthday"] = () => ({ birthday: null, meetsAccountMinimumAge: null, mayAccessSensitiveContent: 1 });
// @ts-expect-error birthday is serialized as String, not native Date
const wrongBirthday: AccountSafetyQueryResolvers["getMyAgeProfile"] = () => ({ birthday: new Date(), meetsAccountMinimumAge: true, mayAccessSensitiveContent: true });
// @ts-expect-error generated non-null mutation result cannot be absent
const absentMutation: AccountSafetyMutationResolvers["setMyBirthday"] = () => undefined;
void [mutations,queries,wrongStatus,wrongEligibility,wrongBirthday,absentMutation];

// @ts-expect-error signed URL output cannot be Boolean
const wrongUrl: AccountSafetyMutationResolvers["createSignedStorageURL"] = () => ({ url: false });
void wrongUrl;
