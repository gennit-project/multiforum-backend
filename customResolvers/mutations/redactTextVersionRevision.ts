import { GraphQLError } from 'graphql'
import type {
  TextVersion,
  TextVersionModel,
  TextVersionUpdateInput,
  TextVersionWhere
} from '../../ogm_types.js'

export const REDACTED_REVISION_BODY = '[deleted]'

type Args = {
  textVersionId: string
}

type Input = {
  TextVersion: TextVersionModel
  revisionType: 'comment' | 'discussion body' | 'wiki'
}

const redactTextVersionRevision = (input: Input) => {
  const { TextVersion, revisionType } = input

  return async (
    parent: any,
    args: Args,
    context: any,
    resolveInfo: any
  ): Promise<TextVersion> => {
    const { textVersionId } = args

    if (!textVersionId) {
      throw new GraphQLError('Revision ID is required')
    }

    const [revision] = await TextVersion.find({
      where: { id: textVersionId },
      selectionSet: `{
        id
        body
        editReason
        createdAt
        updatedAt
        Author {
          username
        }
      }`,
    })

    if (!revision) {
      throw new GraphQLError(`${revisionType} revision not found`)
    }

    if (revision.body === REDACTED_REVISION_BODY) {
      return revision
    }

    const where: TextVersionWhere = {
      id: textVersionId
    }
    const update: TextVersionUpdateInput = {
      body: REDACTED_REVISION_BODY
    }

    const updateResult = await TextVersion.update({
      where,
      update,
      selectionSet: `{
        textVersions {
          id
          body
          editReason
          createdAt
          updatedAt
          Author {
            username
          }
        }
      }`,
    })

    const updatedRevision = updateResult.textVersions[0]
    if (!updatedRevision) {
      throw new GraphQLError(`Error redacting ${revisionType} revision`)
    }

    return updatedRevision
  }
}

export default redactTextVersionRevision
