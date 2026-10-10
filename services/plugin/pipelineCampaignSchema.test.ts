import test from "node:test";
import assert from "node:assert/strict";
import { graphql } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import { Neo4jGraphQL } from "@neo4j/graphql";
import pkg from "@neo4j/graphql-ogm";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import { initializeOgmFromExistingSchema } from "../initializeOgmFromExistingSchema.js";
import { PluginPipelineCampaignStatus } from "../../ogm_types.js";

const { OGM } = pkg;

test("campaign startup OGM lookup is valid but its generated query remains private", async () => {
  const driverReached = new Error("campaign query reached the Neo4j driver");
  const driver = {
    session() {
      throw driverReached;
    },
  } as unknown as Driver;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver });
  const schema = await neoSchema.getSchema();
  const ogm = new OGM({ typeDefs, driver });
  const campaignModel = ogm.model("PluginPipelineCampaign");

  initializeOgmFromExistingSchema(ogm, neoSchema, schema);

  await assert.rejects(
    campaignModel.find({
      where: { status: PluginPipelineCampaignStatus.Running },
      selectionSet: "{ id status }",
    }),
    error =>
      error instanceof Error && error.message === driverReached.message
  );
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
