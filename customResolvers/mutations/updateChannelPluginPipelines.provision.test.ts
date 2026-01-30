import assert from "node:assert/strict";
import updateChannelPluginPipelines from "./updateChannelPluginPipelines.js";

async function testProvisioningRunsForEnabledBotPlugin() {
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
                properties: {
                  enabled: true,
                  settingsJson: { botName: "HelperBot", profiles: [{ id: "fantasy", label: "Fantasy Fan" }] }
                },
                node: { Plugin: { name: "helper-bot", tags: ["bots"] } }
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
    getProfiles: (settingsJson: any) => settingsJson?.profiles || [],
    getBotName: (settingsJson: any) => settingsJson?.botName || null
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
  assert.equal(calledArgs.botName, "HelperBot");
  assert.equal(calledArgs.profiles.length, 1);
}

async function testProvisioningSkipsWhenBotPluginDisabled() {
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
                properties: { enabled: false, settingsJson: { botName: "HelperBot", profiles: [{ id: "fantasy" }] } },
                node: { Plugin: { name: "helper-bot", tags: ["bots"] } }
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

  assert.equal(called, false, "Expected bot provisioning to be skipped when bot plugin disabled");
}

async function run() {
  await testProvisioningRunsForEnabledBotPlugin();
  await testProvisioningSkipsWhenBotPluginDisabled();
  console.log("updateChannelPluginPipelines provisioning tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
