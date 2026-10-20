import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";

import { loadAgePolicy } from "../../services/agePolicy.js";

type Input = {
  agePolicyRepository: AgePolicyReader;
};

const getAgePolicy = ({ agePolicyRepository }: Input) => async () =>
  loadAgePolicy(agePolicyRepository);

export default getAgePolicy;
