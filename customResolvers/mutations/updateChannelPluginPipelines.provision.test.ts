import assert from "node:assert/strict";
import updateChannelPluginPipelines from "./updateChannelPluginPipelines.js";

async function testProvisioningRunsForEnabledBetaBot() {
  let calledArgs: any = null;

  const resolver = updateChannelPluginPipelines({
    Channel: {
      find: async () => [{ uniqueName: "writing", pluginPipelines: [] }],
      update: async () => ({})
    } as any,
    ServerConfig: {
      find: async () => [
        {
          InstalledVersionsConnection: {
            edges: [
              {
                edge: { enabled: true, settingsJson: { profiles: [{ id: "fantasy", label: "Fantasy Fan" }] } },
                node: { Plugin: { name: "beta-bot" } }
              }
            ]
          }
        }
      ]
    } as any,
    User: {} as any,
    ensureBotsForChannel: async (args: any) => {
      calledArgs = args;
    },
    getProfiles: (settingsJson: any) => settingsJson?.profiles || []
  });

  const pipelines = [
    {
      event: "discussionChannel.created",
      steps: [{ pluginId: "auto-labeler" }]
    }
  ];

  await resolver({}, { channelUniqueName: "writing", pipelines }, {}, {});

  assert.ok(calledArgs, "Expected bot provisioning to be called");
  assert.equal(calledArgs.channelUniqueName, "writing");
  assert.equal(calledArgs.botName, "betabot");
  assert.equal(calledArgs.profiles.length, 1);
}

async function testProvisioningSkipsWhenBetaBotDisabled() {
  let called = false;

  const resolver = updateChannelPluginPipelines({
    Channel: {
      find: async () => [{ uniqueName: "writing", pluginPipelines: [] }],
      update: async () => ({})
    } as any,
    ServerConfig: {
      find: async () => [
        {
          InstalledVersionsConnection: {
            edges: [
              {
                edge: { enabled: false, settingsJson: { profiles: [{ id: "fantasy" }] } },
                node: { Plugin: { name: "beta-bot" } }
              }
            ]
          }
        }
      ]
    } as any,
    User: {} as any,
    ensureBotsForChannel: async () => {
      called = true;
    }
  });

  const pipelines = [
    {
      event: "discussionChannel.created",
      steps: [{ pluginId: "auto-labeler" }]
    }
  ];

  await resolver({}, { channelUniqueName: "writing", pipelines }, {}, {});

  assert.equal(called, false, "Expected bot provisioning to be skipped when beta-bot disabled");
}

async function run() {
  await testProvisioningRunsForEnabledBetaBot();
  await testProvisioningSkipsWhenBetaBotDisabled();
  console.log("updateChannelPluginPipelines provisioning tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
