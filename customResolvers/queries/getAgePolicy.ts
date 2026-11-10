import { rememberCanonicalSource } from "../../services/canonicalSourceFields.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";

import { loadAgePolicy } from "../../services/agePolicy.js";

type Input = {
  agePolicyRepository: AgePolicyReader;
};

const getAgePolicy = ({ agePolicyRepository }: Input) => async () =>
  rememberCanonicalSource(await loadAgePolicy(agePolicyRepository));

export default getAgePolicy;
