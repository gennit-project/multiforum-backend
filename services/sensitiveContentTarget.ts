import type { Driver } from "neo4j-driver";

type Target = {
  discussionId?: string | null;
  commentId?: string | null;
  imageId?: string | null;
  issueId?: string | null;
  downloadableFileId?: string | null;
};

/**
 * Determine whether an arbitrary public identifier belongs to sensitive
 * content. This closes custom-resolver paths that do not pass through Neo4j
 * GraphQL's generated authorization filters.
 */
export async function isSensitiveContentTarget(
  driver: Driver,
  target: Target
): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `RETURN
        EXISTS {
          MATCH (discussion:Discussion {id: $discussionId})
          WHERE coalesce(discussion.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (comment:Comment {id: $commentId})-[:IS_REPLY_TO*0..32]->(threadComment:Comment)
            <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
          WHERE coalesce(discussion.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (:Comment {id: $commentId})-[:HAS_FEEDBACK_COMMENT]->(discussion:Discussion)
          WHERE coalesce(discussion.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (:Comment {id: $commentId})-[:HAS_FEEDBACK_COMMENT]->(:Comment)
            -[:IS_REPLY_TO*0..32]->(threadComment:Comment)
            <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
          WHERE coalesce(discussion.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (image:Image {id: $imageId})
          WHERE coalesce(image.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (discussion:Discussion)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id: $downloadableFileId})
          WHERE coalesce(discussion.hasSensitiveContent, false) = true
        }
        OR EXISTS {
          MATCH (issue:Issue {id: $issueId})
          WHERE EXISTS {
            MATCH (issue)-[:TARGETS_DISCUSSION]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          } OR (NOT EXISTS {
            MATCH (issue)-[:TARGETS_DISCUSSION]->()
          } AND EXISTS {
            MATCH (discussion:Discussion {id: issue.relatedDiscussionId})
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          }) OR EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->(comment:Comment)-[:IS_REPLY_TO*0..32]->(threadComment:Comment)
              <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          } OR (NOT EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->()
          } AND EXISTS {
            MATCH (comment:Comment {id: issue.relatedCommentId})-[:IS_REPLY_TO*0..32]->(threadComment:Comment)
              <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          }) OR EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->(:Comment)-[:HAS_FEEDBACK_COMMENT]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          } OR (NOT EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->()
          } AND EXISTS {
            MATCH (:Comment {id: issue.relatedCommentId})-[:HAS_FEEDBACK_COMMENT]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          }) OR EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->(:Comment)-[:HAS_FEEDBACK_COMMENT]->(:Comment)
              -[:IS_REPLY_TO*0..32]->(threadComment:Comment)
              <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          } OR (NOT EXISTS {
            MATCH (issue)-[:TARGETS_COMMENT]->()
          } AND EXISTS {
            MATCH (:Comment {id: issue.relatedCommentId})-[:HAS_FEEDBACK_COMMENT]->(:Comment)
              -[:IS_REPLY_TO*0..32]->(threadComment:Comment)
              <-[:CONTAINS_COMMENT]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
            WHERE coalesce(discussion.hasSensitiveContent, false) = true
          }) OR EXISTS {
            MATCH (issue)-[:TARGETS_IMAGE]->(image:Image)
            WHERE coalesce(image.hasSensitiveContent, false) = true
          } OR (NOT EXISTS {
            MATCH (issue)-[:TARGETS_IMAGE]->()
          } AND EXISTS {
            MATCH (image:Image {id: issue.relatedImageId})
            WHERE coalesce(image.hasSensitiveContent, false) = true
          })
        }
        AS sensitive`,
      {
        discussionId: target.discussionId ?? null,
        commentId: target.commentId ?? null,
        imageId: target.imageId ?? null,
        issueId: target.issueId ?? null,
        downloadableFileId: target.downloadableFileId ?? null,
      }
    );

    return Boolean(result.records[0]?.get("sensitive"));
  } finally {
    await session.close();
  }
}
