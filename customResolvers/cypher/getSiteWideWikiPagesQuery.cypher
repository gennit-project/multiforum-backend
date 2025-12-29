// Count matching wiki pages first
MATCH (w:WikiPage)
WHERE ($searchInput = "" OR w.title =~ $titleRegex OR w.body =~ $bodyRegex)
AND (SIZE($selectedChannels) = 0 OR w.channelUniqueName IN $selectedChannels)
WITH COUNT(w) AS totalCount

// Fetch paginated results
MATCH (w:WikiPage)
WHERE ($searchInput = "" OR w.title =~ $titleRegex OR w.body =~ $bodyRegex)
AND (SIZE($selectedChannels) = 0 OR w.channelUniqueName IN $selectedChannels)
WITH w, totalCount
ORDER BY coalesce(w.updatedAt, w.createdAt) DESC
SKIP toInteger($offset)
LIMIT toInteger($limit)

OPTIONAL MATCH (w)<-[:AUTHORED_VERSION]-(author:User)

RETURN {
  id: w.id,
  title: w.title,
  body: w.body,
  slug: w.slug,
  channelUniqueName: w.channelUniqueName,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
  VersionAuthor: CASE
    WHEN author IS NULL THEN null
    ELSE {
      username: author.username,
      displayName: author.displayName,
      profilePicURL: author.profilePicURL
    }
  END
} AS wikiPage, totalCount
