import { createUnsuspendResolver } from './shared/createUnsuspendResolver.js'

export default function getResolver() {
  return createUnsuspendResolver({
    issueRelatedAccountField: 'relatedModProfileName',
    channelSuspendedField: 'SuspendedMods',
    suspendedEntityName: 'mod',
    unsuspendCommentText: 'The mod has been suspended.'
  })
}
