import type { NativeInstancePolicySelections, CompletedAgePolicy, CompletedSetupPolicy } from "../../customResolvers/contracts/instancePolicySource.js";
import type { CompletedInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
declare const native: NativeInstancePolicySelections;
// @ts-expect-error native database properties have not passed scalar completion
const flag: boolean = native.age.accountAgeGateEnabled;
// @ts-expect-error setup-only selection is unavailable in the age-policy query
const events = native.age.enableEvents;
// @ts-expect-error all selected age-policy keys must be represented
const missing: NativeInstancePolicySelections["age"] = { minimumAccountAge: null };
declare const repository: CompletedInstancePolicyRepository;
const age: Promise<CompletedAgePolicy[]> = repository.findAgePolicyConfigs("server");
const setup: Promise<CompletedSetupPolicy[]> = repository.findSetupConfigs();
// @ts-expect-error scalar completion cannot replace nullable Booleans with strings
const malformed: CompletedSetupPolicy = { enableDownloads: "true", enableEvents: null };
void [flag, events, missing, age, setup, malformed];
