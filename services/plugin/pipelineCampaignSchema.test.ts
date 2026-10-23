import test from "node:test";
import assert from "node:assert/strict";
import { graphql } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";

test("generated PluginPipelineCampaign operations remain private", async () => {
  // No query should reach the driver — graphql-shield denies before resolution.
  const driver = {
    session() {
      throw new Error("campaign query reached the Neo4j driver");
    },
  } as unknown as Driver;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver });
  const schema = await neoSchema.getSchema();
  const protectedSchema = applyMiddleware(schema, permissions);

  const operations = [
    "{ pluginPipelineCampaigns { id } }",
    `mutation {
      createPluginPipelineCampaigns(input: []) {
        pluginPipelineCampaigns { id }
      }
    }`,
    `mutation {
      updatePluginPipelineCampaigns {
        pluginPipelineCampaigns { id }
      }
    }`,
  ];
  const results = await Promise.all(
    operations.map(source => graphql({ schema: protectedSchema, source }))
  );

  for (const result of results) {
    assert.equal(result.errors?.[0]?.message, "Not Authorised!");
  }
});
