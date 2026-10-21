// Unit tests for the channel-bots middleware's updateChannels orchestration
// (syncBotsForChannel). When a channel's EnabledPlugins change, it reconciles the
// channel's bot users: creating/connecting profile bots for enabled bot plugins
// and deprecating/disconnecting orphaned ones. These tests drive its branches —
// the no-plugin-change passthrough, the missing-channel / not-found guards, an
// enabled bot plugin (happy path), orphaned-bot cleanup, and the error path —
// with a stubbed resolver and a permissive in-memory OGM. No DB.
//
// The pure helpers (parseSettingsJson, isBotPlugin) are covered in
// channelBotsMiddleware.test.ts; this file covers the DB-orchestration path.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./channelBotsMiddleware.js";

const M: any = (middleware as any).Mutation;

// Build a ctx. Channel.find returns `channel`, ServerConfig.find returns
// `serverConfigs`. `ops` records the write operations the sync performs.
function makeCtx(opts: { channel?: any; serverConfigs?: any[] } = {}) {
  const ops: string[] = [];
  const model = (name: string) => ({
    find: async () => {
      if (name === "Channel") return opts.channel ? [opts.channel] : [];
      if (name === "ServerConfig") return opts.serverConfigs ?? [];
      return [];
    },
    create: async () => {
      ops.push(`${name}.create`);
      return { [`${name.toLowerCase()}s`]: [{ username: "bot-x" }] };
    },
    update: async (args: any) => {
      ops.push(`${name}.update`);
      return {};
    },
  });
  return { ctx: { ogm: { model }, driver: {}, channelBotRepository:{findChannelPlugins:async()=>opts.channel?[opts.channel]:[],findServerPlugins:async()=>opts.serverConfigs??[],deprecateBot:async()=>{ops.push("User.update");return{users:[]};},disconnectOrphans:async()=>{ops.push("Channel.update");return{channels:[]};}}, botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>{ops.push("User.create");return {users:[{username:"bot-x"}]};},reactivateIdentity:async()=>{ops.push("User.update");return{users:[]};},findChannelBots:async()=>opts.channel?[opts.channel]:[],connectBot:async()=>{ops.push("Channel.update");return{channels:[]};},disconnectBots:async()=>{ops.push("Channel.update");return{channels:[]};}} } as any, ops };
}

function resolveReturning(result: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

const botPluginEdge = (opts: { enabled?: boolean; settingsDefaults?: string; settingsJson?: string; tags?: string[] } = {}) => ({
  properties: { enabled: opts.enabled ?? true, settingsJson: opts.settingsJson ?? "{}" },
  node: {
    settingsDefaults: opts.settingsDefaults ?? "{}",
    Plugin: { name: "bot-plugin", tags: opts.tags ?? ["bot"] },
  },
});

test("does not sync when the update does not touch EnabledPlugins", async () => {
  const { ctx, ops } = makeCtx({ channel: { uniqueName: "cats", Bots: [] } });
  const { resolve, state } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  await M.updateChannels(resolve, null, { where: { uniqueName: "cats" }, update: { description: "x" } }, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(ops, []); // sync never ran
});

test("syncs but returns early when no channel name can be resolved", async () => {
  const { ctx, ops } = makeCtx();
  const { resolve } = resolveReturning({ updateChannels: { channels: [] } });
  await M.updateChannels(resolve, null, { update: { EnabledPlugins: [{}] } }, ctx, {});
  assert.deepEqual(ops, []);
});

test("syncs but returns early when the channel is not found", async () => {
  const { ctx, ops } = makeCtx({ channel: undefined });
  const { resolve } = resolveReturning({ updateChannels: { channels: [] } });
  await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "ghost" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  assert.deepEqual(ops, []);
});

test("a channel with no enabled bot plugins and no bots performs no writes", async () => {
  const channel = {
    uniqueName: "cats",
    Bots: [],
    EnabledPluginsConnection: { edges: [botPluginEdge({ enabled: false })] },
  };
  const { ctx, ops } = makeCtx({ channel });
  const { resolve } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "cats" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  assert.deepEqual(ops, []);
});

test("an enabled bot plugin with a botName provisions profile bots", async () => {
  const channel = {
    uniqueName: "cats",
    Bots: [],
    EnabledPluginsConnection: {
      edges: [
        botPluginEdge({
          settingsDefaults: JSON.stringify({ botName: "helper" }),
          settingsJson: JSON.stringify({ profiles: [{ id: "p1", label: "Helper One" }] }),
        }),
      ],
    },
  };
  const { ctx, ops } = makeCtx({ channel });
  const { resolve, state } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  const out = await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "cats" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
  assert.deepEqual(out, { updateChannels: { channels: [{ uniqueName: "cats" }] } });
});

test("an enabled bot plugin without a botName is skipped", async () => {
  const channel = {
    uniqueName: "cats",
    Bots: [],
    EnabledPluginsConnection: {
      edges: [botPluginEdge({ settingsDefaults: "{}", settingsJson: "{}" })], // no botName anywhere
    },
  };
  const { ctx } = makeCtx({ channel });
  const { resolve, state } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "cats" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
});

test("orphaned channel bots are deprecated and disconnected", async () => {
  const channel = {
    uniqueName: "cats",
    Bots: [{ username: "bot-old-profile" }], // an orphan, no longer desired
    EnabledPluginsConnection: { edges: [] },
  };
  const { ctx, ops } = makeCtx({ channel });
  const { resolve } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "cats" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  // deprecate (User.update) + disconnect (Channel.update)
  assert.ok(ops.includes("User.update"), "deprecated the orphan bot");
  assert.ok(ops.includes("Channel.update"), "disconnected the orphan bot");
});

test("errors during sync are swallowed and the resolver result still returns", async () => {
  const ctx: any = {
    channelBotRepository:{findChannelPlugins:async()=>{throw new Error("db down");}},
    ogm: {
      model: () => ({
        find: async () => {
          throw new Error("db down");
        },
        update: async () => ({}),
        create: async () => ({}),
      }),
    },
    driver: {},
  };
  const { resolve, state } = resolveReturning({ updateChannels: { channels: [{ uniqueName: "cats" }] } });
  const out = await M.updateChannels(
    resolve,
    null,
    { where: { uniqueName: "cats" }, update: { EnabledPlugins: [{}] } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
  assert.deepEqual(out, { updateChannels: { channels: [{ uniqueName: "cats" }] } });
});

test('underlying mutation failure skips bot reads; deprecation failure preserves sequential partial work and skips disconnect',async()=>{
 const calls:string[]=[];const result={updateChannels:{channels:[{uniqueName:'cats'}]}};const ctx:any={driver:{},channelBotRepository:{findChannelPlugins:async()=>{calls.push('channel');return[{Bots:[{username:'bot-first'},{username:'bot-second'},{username:'human'}],EnabledPluginsConnection:{edges:[]}}];},findServerPlugins:async()=>{calls.push('server');return[];},deprecateBot:async(name:string)=>{calls.push(name);if(name==='bot-second')throw new Error('failure');return{users:[]};},disconnectOrphans:async()=>{calls.push('disconnect');return{channels:[]};}}};
 await assert.rejects(M.updateChannels(async()=>{throw new Error('mutation failed');},null,{where:{uniqueName:'cats'},update:{EnabledPlugins:[{}]}},ctx,{}),/mutation failed/);assert.equal(calls.length,0);
 assert.equal(await M.updateChannels(async()=>{calls.push('resolve');return result;},null,{where:{uniqueName:'cats'},update:{EnabledPlugins:[{}]}},ctx,{}),result);assert.deepEqual(calls,['resolve','channel','server','bot-first','bot-second']);
});
