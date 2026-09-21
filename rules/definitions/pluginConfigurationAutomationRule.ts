import type { GraphQLResolveInfo } from "graphql";
import { rule } from "graphql-shield";

import { authenticatePluginConfigurationAutomation } from "../../services/pluginConfigurationAutomationAuth.js";
import type { GraphQLContext } from "../../types/context.js";

export const isPluginConfigurationAutomation = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    _args: unknown,
    context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => authenticatePluginConfigurationAutomation(context)
);
