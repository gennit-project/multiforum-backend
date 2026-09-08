import type { ServerConfigModel } from "../../ogm_types.js";
import { loadAgePolicy } from "../../services/agePolicy.js";

type Input = {
  ServerConfig: ServerConfigModel;
};

const getAgePolicy = ({ ServerConfig }: Input) => async () =>
  loadAgePolicy(ServerConfig);

export default getAgePolicy;
