import assert from "node:assert/strict";
import { test } from "node:test";
import { resolverContractType, resolverFields } from "./resolverContractInventory.js";
import { pluginPolicyDomainMutationNames } from "../customResolvers/contracts/pluginPolicies.js";

test("JSON policy domain contracts check both actual mutation registrations", () => {
  const file = "customResolvers/mutationResolvers.ts";
  assert.equal(resolverContractType(file, "pluginPolicyDomainResolvers"), "PluginPolicyDomainMutationResolvers");
  assert.deepEqual(resolverFields(file, "Mutation", "pluginPolicyDomainResolvers"),
    pluginPolicyDomainMutationNames.map(name => `Mutation.${name}`).sort());
});
