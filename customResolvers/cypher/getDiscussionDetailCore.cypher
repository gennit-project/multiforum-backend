MATCH (discussion:Discussion {id: $discussionId})
WHERE $mayAccessSensitiveContent
   OR coalesce(discussion.hasSensitiveContent, false) = false

OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)

CALL {
  WITH discussion
  OPTIONAL MATCH (discussion)-[:HAS_TAG]->(tag:Tag)
  RETURN [value IN collect(DISTINCT tag.text) WHERE value IS NOT NULL |
    {text: value}
  ] AS tags
}

CALL {
  WITH discussion
  OPTIONAL MATCH (discussion)-[:HAS_ALBUM]->(album:Album)
  CALL {
    WITH album
    OPTIONAL MATCH (album)-[:HAS_IMAGE]->(image:Image)
    WHERE image IS NOT NULL
      AND coalesce(image.archived, false) = false
      AND coalesce(image.permanentlyRemoved, false) = false
      AND ($mayAccessSensitiveContent OR coalesce(image.hasSensitiveContent, false) = false)
    OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(image)
    WITH image, uploader
    ORDER BY image.createdAt DESC, image.id ASC
    LIMIT toInteger($imageLimit)
    RETURN [entry IN collect(CASE WHEN image IS NULL THEN null ELSE image {
      .id,
      .url,
      .alt,
      .caption,
      .copyright,
      Uploader: CASE WHEN uploader IS NULL THEN null ELSE uploader {
        .username,
        .displayName
      } END
    } END) WHERE entry IS NOT NULL] AS images
  }
  RETURN CASE WHEN album IS NULL THEN null ELSE album {
    .id,
    .imageOrder,
    Images: images
  } END AS album
}

CALL {
  WITH discussion
  OPTIONAL MATCH (discussion)-[:CROSSPOSTED_DISCUSSION]->(crosspost:Discussion)
  WHERE crosspost IS NULL
     OR $mayAccessSensitiveContent
     OR coalesce(crosspost.hasSensitiveContent, false) = false
  OPTIONAL MATCH (crosspostAuthor:User)-[:POSTED_DISCUSSION]->(crosspost)
  OPTIONAL MATCH (crosspost)-[:HAS_ALBUM]->(crosspostAlbum:Album)
  CALL {
    WITH crosspostAlbum
    OPTIONAL MATCH (crosspostAlbum)-[:HAS_IMAGE]->(image:Image)
    WHERE image IS NOT NULL
      AND coalesce(image.archived, false) = false
      AND coalesce(image.permanentlyRemoved, false) = false
      AND ($mayAccessSensitiveContent OR coalesce(image.hasSensitiveContent, false) = false)
    OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(image)
    WITH image, uploader
    ORDER BY image.createdAt DESC, image.id ASC
    LIMIT toInteger($previewImageLimit)
    RETURN [entry IN collect(CASE WHEN image IS NULL THEN null ELSE image {
      .id,
      .url,
      .alt,
      .caption,
      .copyright,
      Uploader: CASE WHEN uploader IS NULL THEN null ELSE uploader {
        .username,
        .displayName
      } END
    } END) WHERE entry IS NOT NULL] AS images
  }
  CALL {
    WITH crosspost
    OPTIONAL MATCH (crosspost)<-[:POSTED_IN_CHANNEL]-(entry:DiscussionChannel)
    OPTIONAL MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel)
    RETURN [item IN collect(DISTINCT CASE WHEN entry IS NULL THEN null ELSE {
      channelUniqueName: entry.channelUniqueName,
      Channel: CASE WHEN channel IS NULL THEN null ELSE channel {
        .uniqueName,
        .displayName
      } END
    } END) WHERE item IS NOT NULL] AS channels
  }
  RETURN CASE WHEN crosspost IS NULL THEN null ELSE crosspost {
    .id,
    .title,
    .body,
    .createdAt,
    Author: CASE WHEN crosspostAuthor IS NULL THEN null ELSE crosspostAuthor {
      .username,
      .displayName,
      .profilePicURL
    } END,
    Album: CASE WHEN crosspostAlbum IS NULL THEN null ELSE crosspostAlbum {
      .id,
      .imageOrder,
      Images: images
    } END,
    DiscussionChannels: channels
  } END AS crosspostedDiscussion
}

CALL {
  WITH discussion
  OPTIONAL MATCH (discussion)-[:SHARES_COLLECTION]->(collection:Collection)
  OPTIONAL MATCH (collection)-[:CREATED_BY]->(creator:User)
  CALL {
    WITH collection
    OPTIONAL MATCH (collection)-[:CONTAINS_DISCUSSION|CONTAINS_COMMENT|CONTAINS_DOWNLOAD|CONTAINS_IMAGE|CONTAINS_CHANNEL]->(item)
    RETURN count(item) AS itemCount
  }
  RETURN CASE WHEN collection IS NULL THEN null ELSE collection {
    .id,
    .name,
    .description,
    .collectionType,
    .visibility,
    itemCount: itemCount,
    CreatedBy: CASE WHEN creator IS NULL THEN null ELSE creator {
      .username,
      .displayName,
      .profilePicURL
    } END
  } END AS sharedCollection
}

CALL {
  WITH discussion
  OPTIONAL MATCH (feedback:Comment)-[:HAS_FEEDBACK_COMMENT]->(discussion)
  RETURN count(feedback) AS feedbackCount
}

CALL {
  WITH discussion
  OPTIONAL MATCH (viewerMod:ModerationProfile {displayName: $viewerModName})-[:AUTHORED_COMMENT]->(viewerFeedback:Comment)-[:HAS_FEEDBACK_COMMENT]->(discussion)
  RETURN [entry IN collect(CASE WHEN viewerFeedback IS NULL THEN null ELSE {id: viewerFeedback.id} END)
    WHERE entry IS NOT NULL][..1] AS viewerFeedback
}

CALL {
  WITH discussion
  OPTIONAL MATCH (viewer:User {username: $viewerUsername})
  WITH discussion, viewer,
    EXISTS { (viewer)-[:DEFAULT_FAVORITES_DISCUSSIONS]->(discussion) }
      OR EXISTS { (viewer)-[:DEFAULT_FAVORITES_DOWNLOADS]->(discussion) } AS favorited
  RETURN CASE
    WHEN $viewerUsername IS NULL OR $viewerUsername = '' THEN null
    ELSE favorited
  END AS isFavorited
}

RETURN discussion {
  .id,
  .title,
  .body,
  .createdAt,
  .updatedAt,
  .hasDownload,
  .hasSensitiveContent,
  Author: CASE WHEN author IS NULL THEN null ELSE author {
    .username,
    .displayName,
    .profilePicURL,
    .createdAt,
    .discussionKarma,
    .commentKarma
  } END,
  Album: album,
  Tags: tags,
  FeedbackCommentsAggregate: {count: feedbackCount},
  FeedbackComments: viewerFeedback,
  CrosspostedDiscussion: crosspostedDiscussion,
  SharedCollection: sharedCollection,
  isFavorited: isFavorited
} AS Discussion
