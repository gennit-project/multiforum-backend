import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphQLResolveInfo } from 'graphql'

import type { ModelMap } from '../../ogm_types.js'
import type { GraphQLContext } from '../../types/context.js'
import getResolver, { parsePluginSettings } from './enableServerPlugin.js'

type Models = Pick<
  ModelMap,
  'Plugin' | 'PluginVersion' | 'ServerConfig' | 'ServerSecret'
>

test('parsePluginSettings accepts records and safely rejects malformed storage', () => {
  assert.deepEqual(parsePluginSettings({ retries: 3 }), { retries: 3 })
  assert.deepEqual(parsePluginSettings('{"retries":3}'), { retries: 3 })
  assert.deepEqual(parsePluginSettings(null), {})
  assert.deepEqual(parsePluginSettings('not-json'), {})
  assert.deepEqual(parsePluginSettings('[1,2]'), {})
  assert.deepEqual(parsePluginSettings(['not', 'settings']), {})
})

test('preserves installed settings when enablement omits settingsJson', async () => {
  let updateInput: unknown
  const models = {
    Plugin: {
      find: async () => [{
        id: 'plugin-node',
        name: 'security-attachment-scan',
        tags: [],
        Versions: [{
          id: 'version-node',
          version: '0.4.0',
          manifest: { settings: [] },
        }],
      }],
    },
    PluginVersion: {},
    ServerConfig: {
      find: async () => [{
        serverName: 'Topical',
        InstalledVersions: [{ id: 'version-node', version: '0.4.0' }],
        InstalledVersionsConnection: {
          edges: [{
            properties: {
              settingsJson: JSON.stringify({
                serviceUrl: 'https://scanner.example.test',
              }),
            },
          }],
        },
      }],
      update: async (input: unknown) => {
        updateInput = input
        return { serverConfigs: [] }
      },
    },
    ServerSecret: { find: async () => [] },
  } as unknown as Models

  const result = await getResolver({repository:{
    findPlugin:async()=>models.Plugin.find(),findInstallations:async()=>models.ServerConfig.find(),findSecrets:async()=>models.ServerSecret.find(),
    setInstallation:async(serverName,id,enabled,settingsJson)=>{await models.ServerConfig.update({where:{serverName},update:{InstalledVersions:[{where:{node:{id}},update:{edge:{enabled,settingsJson}}}]}})}
  }})(
    {},
    {
      pluginId: 'security-attachment-scan',
      version: '0.4.0',
      enabled: true,
    },
    {} as GraphQLContext,
    {} as GraphQLResolveInfo
  )

  assert.deepEqual(result.settingsJson, {
    serviceUrl: 'https://scanner.example.test',
  })
  assert.deepEqual(updateInput, {
    where: { serverName: 'Topical' },
    update: {
      InstalledVersions: [{
        where: { node: { id: 'version-node' } },
        update: {
          edge: {
            enabled: true,
            settingsJson: JSON.stringify({
              serviceUrl: 'https://scanner.example.test',
            }),
          },
        },
      }],
    },
  })
})

test('server allowlist validation is independent of forum eligibility', async () => {
  for (const serverList of [[], ['cats'], null, ['cats', 1], 'cats']) {
    let writes = 0
    const resolver = getResolver({repository:{
      findPlugin:async()=>[{id:'p',name:'llm-moderation',tags:[],displayName:null,description:null,authorName:null,authorUrl:null,homepage:null,license:null,metadata:null,Versions:[{id:'v',version:'0.8.0',manifest:{},settingsDefaults:null,uiSchema:null,documentationPath:null,readmeMarkdown:null,registryUrl:null,releaseNotesUrl:null,sourceRepoUrl:null,sourceCommit:null,minServerVersion:null,apiVersion:null}]}],
      findInstallations:async()=>[{serverName:'s',InstalledVersions:[{id:'v',version:'0.8.0'}],InstalledVersionsConnection:{edges:[]}}],
      findSecrets:async()=>[],setInstallation:async()=>{writes++},
    }})
    const run = resolver({}, {pluginId:'llm-moderation',version:'0.8.0',enabled:true,settingsJson:{serverRuleEnforcement:'allowlist',serverRuleForumAllowlist:serverList,channelRuleEligibility:'none',channelRuleAllowlist:[]}}, {} as GraphQLContext, {} as GraphQLResolveInfo)
    if (Array.isArray(serverList) && serverList.every(v=>typeof v==='string')) {await run;assert.equal(writes,1)}
    else {await assert.rejects(run,/serverRuleForumAllowlist must be a string array/);assert.equal(writes,0)}
  }
})
