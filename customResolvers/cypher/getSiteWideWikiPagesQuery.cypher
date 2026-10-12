// Count matching wiki pages first
MATCH (owner:Channel)-[:OWNS_WIKI_PAGE]->(w:WikiPage)
WHERE SIZE($selectedChannels) = 0 OR owner.uniqueName IN $selectedChannels
WITH COUNT(w) AS totalCount

// Fetch paginated results
MATCH (owner:Channel)-[:OWNS_WIKI_PAGE]->(w:WikiPage)
WHERE SIZE($selectedChannels) = 0 OR owner.uniqueName IN $selectedChannels
WITH w, owner, totalCount
ORDER BY coalesce(w.updatedAt, w.createdAt) DESC
SKIP toInteger($offset)
LIMIT toInteger($limit)

OPTIONAL MATCH (w)<-[:AUTHORED_VERSION]-(author:User)

RETURN {
  id: w.id,
  title: w.title,
  body: w.body,
  slug: w.slug,
  channelUniqueName: owner.uniqueName,
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
