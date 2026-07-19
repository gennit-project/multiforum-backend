import { GraphQLError } from 'graphql'
import type { Driver } from 'neo4j-driver'
import {
  setUserDataOnContext,
  type UserDataOnContext
} from '../../rules/permission/userDataHelperFunctions.js'
import type { GraphQLContext } from '../../types/context.js'

type Args = {
  downloadableFileId: string
  discussionId: string
}

type GetUserData = typeof setUserDataOnContext

type Input = {
  driver: Driver
  getUserData?: GetUserData
}

type Neo4jCount = number | { toNumber: () => number } | null | undefined

export const AUTO_SAVED_DOWNLOADS_COLLECTION_NAME = 'Downloaded Items'
export const AUTO_SAVED_DOWNLOADS_COLLECTION_DESCRIPTION =
  'Items appear here automatically when you download them.'

const toNumber = (value: Neo4jCount) => {
  if (typeof value === 'number') {
    return value
  }

  return value?.toNumber() ?? 0
}

const getCurrentUser = async (input: {
  context: GraphQLContext
  getUserData: GetUserData
}): Promise<UserDataOnContext> => {
  const { context, getUserData } = input

  if (context.user?.username) {
    return context.user
  }

  context.user = await getUserData({
    context,
  })

  return context.user
}

const trackDownload = ({
  driver,
  getUserData = setUserDataOnContext
}: Input) => {
  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    const { downloadableFileId, discussionId } = args

    if (!downloadableFileId) {
      throw new GraphQLError('Downloadable file ID is required')
    }

    if (!discussionId) {
      throw new GraphQLError('Discussion ID is required')
    }

    const currentUser = await getCurrentUser({ context, getUserData })
    const username = currentUser?.username || null

    const session = driver.session({ defaultAccessMode: 'WRITE' })

    try {
      if (!username) {
        const result = await session.run(
          `
          MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
          WHERE coalesce(file.scanStatus, 'PENDING') = 'CLEAN'
          SET file.downloadCountTotal = coalesce(file.downloadCountTotal, 0) + 1
          RETURN count(file) AS updated
          `,
          {
            downloadableFileId,
            discussionId
          }
        )

        const updated = toNumber(result.records[0]?.get('updated'))

        if (updated < 1) {
          throw new GraphQLError('Downloadable file not found for this discussion')
        }

        return true
      }

      const result = await session.run(
        `
        MATCH (user:User {username: $username})
        MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
        OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)
        WITH user, discussion, file, collect(DISTINCT author.username) AS authorUsernames
        WHERE coalesce(file.scanStatus, 'PENDING') = 'CLEAN'
          OR file.uploadedByUsername = $username
          OR $username IN authorUsernames
        OPTIONAL MATCH (user)-[existingDownload:DOWNLOADED_FILE]->(file)
        MERGE (user)<-[:CREATED_BY]-(downloadsCollection:Collection {
          name: $downloadsCollectionName,
          collectionType: 'DOWNLOADS'
        })
          ON CREATE SET
            downloadsCollection.id = randomUUID(),
            downloadsCollection.description = $downloadsCollectionDescription,
            downloadsCollection.visibility = 'PRIVATE',
            downloadsCollection.itemOrder = [],
            downloadsCollection.createdAt = datetime(),
            downloadsCollection.updatedAt = datetime()
        WITH user, discussion, file, downloadsCollection, existingDownload IS NULL AS isUnique
        MERGE (user)-[download:DOWNLOADED_FILE]->(file)
          ON CREATE SET download.createdAt = datetime()
        OPTIONAL MATCH (downloadsCollection)-[existingCollectionDownload:CONTAINS_DOWNLOAD]->(discussion)
        FOREACH (_ IN CASE WHEN existingCollectionDownload IS NULL THEN [1] ELSE [] END |
          MERGE (downloadsCollection)-[:CONTAINS_DOWNLOAD]->(discussion)
          SET downloadsCollection.itemOrder = coalesce(downloadsCollection.itemOrder, []) + [$discussionId]
        )
        SET
          download.lastDownloadedAt = datetime(),
          downloadsCollection.updatedAt = datetime(),
          file.downloadCountTotal = coalesce(file.downloadCountTotal, 0) + 1,
          file.downloadCountUnique = coalesce(file.downloadCountUnique, 0) + CASE WHEN isUnique THEN 1 ELSE 0 END
        MERGE (user)-[:OWNS_DOWNLOAD]->(discussion)
        RETURN count(file) AS updated
        `,
        {
          username,
          downloadsCollectionName: AUTO_SAVED_DOWNLOADS_COLLECTION_NAME,
          downloadsCollectionDescription:
            AUTO_SAVED_DOWNLOADS_COLLECTION_DESCRIPTION,
          downloadableFileId,
          discussionId
        }
      )

      const updated = toNumber(result.records[0]?.get('updated'))

      if (updated < 1) {
        throw new GraphQLError('Downloadable file is unavailable or not found for this discussion')
      }

      return true
    } finally {
      session.close()
    }
  }
}

export default trackDownload
