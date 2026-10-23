import { createHash } from 'node:crypto'

type ContentRevisionInput = {
  channelUniqueName: string
  contentId: string
  contentType: 'Comment' | 'Discussion'
  title?: string | null
  body?: string | null
  text?: string | null
  attachmentVersion?: string | null
}

type RuleSetVersionInput = {
  pluginId: string
  pluginVersion: string
  serverRules: string[]
  forumRules: string[]
}

type ReportIdempotencyKeyInput = {
  channelUniqueName: string
  contentType: 'comment' | 'discussion' | 'event'
  contentId: string
  contentRevisionHash: string
  ruleSetVersion: string
  pluginId: string
  pluginVersion: string
}

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const normalizeRules = (rules: string[]) =>
  [...new Set(rules.map(rule => rule.trim()).filter(Boolean))].sort()

export const createContentRevisionHash = (input: ContentRevisionInput) =>
  digest({
    version: 1,
    channelUniqueName: input.channelUniqueName,
    contentType: input.contentType,
    contentId: input.contentId,
    title: input.title || '',
    body: input.body || '',
    text: input.text || '',
    attachmentVersion: input.attachmentVersion || '',
  })

export const createRuleSetVersion = (input: RuleSetVersionInput) =>
  digest({
    version: 1,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    serverRules: normalizeRules(input.serverRules),
    forumRules: normalizeRules(input.forumRules),
  })

export const createReportIdempotencyKey = (
  input: ReportIdempotencyKeyInput
) => `bot-report:v1:${digest(input)}`
